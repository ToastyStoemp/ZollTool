import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { PullResponse, PushResponse, TokenResponse, WireOp } from '@zolltool/shared';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  process.env.REGISTRATION_OPEN = '1';
  process.env.REQUIRE_CAPTCHA = '0';
  process.env.OWNER_EMAIL = 'owner@example.com';
  process.env.OWNER_PASSWORD = 'owner-secret-pw';
  dataDir = mkdtempSync(join(tmpdir(), 'zolltool-test-'));
  app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret' });
});

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function op(opId: string, deviceId: string, type: WireOp['type'] = 'tx.create', payload: unknown = { n: 1 }): WireOp {
  return { opId: opId.padEnd(16, '0'), deviceId, ts: Date.now(), type, payload };
}

async function register(email: string, extra: Record<string, unknown> = {}): Promise<TokenResponse> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'password123', accountName: email.split('@')[0], ...extra },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('sync server', () => {
  let alice: TokenResponse;
  let bert: TokenResponse;

  it('registers accounts and seeds the owner from env', async () => {
    alice = await register('alice@example.com');
    bert = await register('bert@example.com');
    expect(alice.user.accountId).not.toBe(bert.user.accountId);

    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'owner@example.com', password: 'owner-secret-pw' },
    });
    expect(ownerLogin.statusCode).toBe(200);
    expect((ownerLogin.json() as TokenResponse).user.role).toBe('owner');
  });

  it('rejects a wrong password and unauthenticated sync', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.com', password: 'wrong' },
    });
    expect(bad.statusCode).toBe(401);
    const noAuth = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0' });
    expect(noAuth.statusCode).toBe(401);
  });

  it('accepts pushed ops, assigns sequential seqs, and is idempotent on re-push', async () => {
    const ops = [op('op-a1', 'dev-1'), op('op-a2', 'dev-1'), op('op-a3', 'dev-1', 'product.upsert')];
    const push = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { deviceId: 'dev-1', ops },
    });
    expect(push.statusCode).toBe(200);
    expect(push.json() as PushResponse).toEqual({ accepted: 3, duplicates: 0, latestSeq: 3 });

    // Retry after a flaky network: same batch, nothing double-applied.
    const retry = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { deviceId: 'dev-1', ops },
    });
    expect(retry.json() as PushResponse).toEqual({ accepted: 0, duplicates: 3, latestSeq: 3 });
  });

  it('pulls ops in order and respects since', async () => {
    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?since=0',
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    const body = pull.json() as PullResponse;
    expect(body.latestSeq).toBe(3);
    expect(body.ops.map((o) => o.serverSeq)).toEqual([1, 2, 3]);
    expect(body.ops[2].type).toBe('product.upsert');

    const partial = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?since=2',
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect((partial.json() as PullResponse).ops.map((o) => o.serverSeq)).toEqual([3]);
  });

  it('isolates accounts from each other', async () => {
    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?since=0',
      headers: { authorization: `Bearer ${bert.accessToken}` },
    });
    const body = pull.json() as PullResponse;
    expect(body.ops).toEqual([]);
    expect(body.latestSeq).toBe(0);
  });

  it('lets a member join via invite and see the account ops', async () => {
    const invite = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: {},
    });
    expect(invite.statusCode).toBe(200);
    const { code } = invite.json() as { code: string };

    const helper = await register('helper@example.com', { inviteCode: code });
    expect(helper.user.accountId).toBe(alice.user.accountId);
    expect(helper.user.role).toBe('member');

    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?since=0',
      headers: { authorization: `Bearer ${helper.accessToken}` },
    });
    expect((pull.json() as PullResponse).ops).toHaveLength(3);

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'again@example.com', password: 'password123', inviteCode: code },
    });
    // invite is single-use — but registration is open in tests, so it still succeeds
    // as a fresh account rather than joining alice's
    expect((reuse.json() as TokenResponse).user.accountId).not.toBe(alice.user.accountId);
  });

  it('rotates refresh tokens (old one becomes invalid)', async () => {
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: alice.refreshToken },
    });
    expect(r1.statusCode).toBe(200);
    const fresh = r1.json() as TokenResponse;
    expect(fresh.accessToken).toBeTruthy();

    const r2 = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: alice.refreshToken },
    });
    expect(r2.statusCode).toBe(401);
    alice = fresh;
  });

  it('stores and serves full-size images per account', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/images/img-123',
      headers: { authorization: `Bearer ${alice.accessToken}`, 'content-type': 'image/jpeg' },
      payload: bytes,
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: '/api/images/img-123',
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toContain('image/jpeg');
    expect(get.rawPayload.equals(bytes)).toBe(true);

    // Bert's account has no such image.
    const cross = await app.inject({
      method: 'GET',
      url: '/api/images/img-123',
      headers: { authorization: `Bearer ${bert.accessToken}` },
    });
    expect(cross.statusCode).toBe(404);
  });
});
