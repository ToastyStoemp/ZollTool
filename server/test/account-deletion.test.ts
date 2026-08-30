import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { TokenResponse, WireOp } from '@zolltool/shared';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let dataDir: string;

const opId = (s: string) => s.padEnd(16, '0');
const wire = (id: string, type: WireOp['type'], payload: unknown): WireOp => ({ opId: opId(id), deviceId: 'd1', ts: Date.now(), type, payload });
const register = (payload: object) => app.inject({ method: 'POST', url: '/api/auth/register', payload });
const login = (email: string, password: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });

beforeAll(async () => {
  process.env.REGISTRATION_OPEN = '1';
  process.env.REQUIRE_CAPTCHA = '0';
  process.env.OWNER_EMAIL = 'srv@owner.test';
  process.env.OWNER_PASSWORD = 'owner-secret-pw';
  dataDir = mkdtempSync(join(tmpdir(), 'zolltool-del-'));
  app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret-xx' });
});
afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function newAccountWithData(email: string): Promise<TokenResponse> {
  const admin = (await register({ email, password: 'password123', accountName: 'Acme' })).json() as TokenResponse;
  await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    headers: { authorization: `Bearer ${admin.accessToken}` },
    payload: { deviceId: 'd1', ops: [wire('ev1', 'event.upsert', { id: 'E1', name: 'Con', updatedAt: 1 })] },
  });
  return admin;
}

describe('self-service deletion', () => {
  it('lets a member delete their own account but keeps the shared data', async () => {
    const admin = await newAccountWithData('boss1@acme.test');
    const inv = (await app.inject({ method: 'POST', url: '/api/invites', headers: { authorization: `Bearer ${admin.accessToken}` }, payload: {} })).json() as { code: string };
    const member = (await register({ email: 'help1@acme.test', password: 'password123', inviteCode: inv.code })).json() as TokenResponse;

    // Wrong password is rejected.
    const bad = await app.inject({ method: 'POST', url: '/api/users/me/delete', headers: { authorization: `Bearer ${member.accessToken}` }, payload: { password: 'nope' } });
    expect(bad.statusCode).toBe(401);

    const ok = await app.inject({ method: 'POST', url: '/api/users/me/delete', headers: { authorization: `Bearer ${member.accessToken}` }, payload: { password: 'password123' } });
    expect(ok.statusCode).toBe(200);
    expect((await login('help1@acme.test', 'password123')).statusCode).toBe(401); // user gone

    // The admin and the account's data are untouched.
    const events = await app.inject({ method: 'GET', url: '/api/data/events', headers: { authorization: `Bearer ${admin.accessToken}` } });
    expect(events.statusCode).toBe(200);
    expect((events.json() as { id: string }[]).map((e) => e.id)).toEqual(['E1']);
  });

  it('blocks the last admin from self-deleting (must delete the account instead)', async () => {
    const admin = await newAccountWithData('boss2@acme.test');
    const r = await app.inject({ method: 'POST', url: '/api/users/me/delete', headers: { authorization: `Bearer ${admin.accessToken}` }, payload: { password: 'password123' } });
    expect(r.statusCode).toBe(409);
  });

  it('refuses account deletion from a member, and a wrong password', async () => {
    const admin = await newAccountWithData('boss3@acme.test');
    const inv = (await app.inject({ method: 'POST', url: '/api/invites', headers: { authorization: `Bearer ${admin.accessToken}` }, payload: {} })).json() as { code: string };
    const member = (await register({ email: 'help3@acme.test', password: 'password123', inviteCode: inv.code })).json() as TokenResponse;

    const byMember = await app.inject({ method: 'POST', url: '/api/account/delete', headers: { authorization: `Bearer ${member.accessToken}` }, payload: { password: 'password123' } });
    expect(byMember.statusCode).toBe(403);

    const wrongPw = await app.inject({ method: 'POST', url: '/api/account/delete', headers: { authorization: `Bearer ${admin.accessToken}` }, payload: { password: 'wrong' } });
    expect(wrongPw.statusCode).toBe(401);
  });

  it('deletes the whole account + all data + all users', async () => {
    const admin = await newAccountWithData('boss4@acme.test');
    const inv = (await app.inject({ method: 'POST', url: '/api/invites', headers: { authorization: `Bearer ${admin.accessToken}` }, payload: {} })).json() as { code: string };
    await register({ email: 'help4@acme.test', password: 'password123', inviteCode: inv.code });

    const del = await app.inject({ method: 'POST', url: '/api/account/delete', headers: { authorization: `Bearer ${admin.accessToken}` }, payload: { password: 'password123' } });
    expect(del.statusCode).toBe(200);

    // Both users can no longer log in, and the account's data is gone.
    expect((await login('boss4@acme.test', 'password123')).statusCode).toBe(401);
    expect((await login('help4@acme.test', 'password123')).statusCode).toBe(401);
    const events = await app.inject({ method: 'GET', url: '/api/data/events', headers: { authorization: `Bearer ${admin.accessToken}` } });
    expect(events.json() as unknown[]).toEqual([]); // ops wiped (JWT still parses until expiry)

    // The email is freed — it can register a fresh account.
    expect((await register({ email: 'boss4@acme.test', password: 'password123', accountName: 'Reborn' })).statusCode).toBe(200);
  });
});
