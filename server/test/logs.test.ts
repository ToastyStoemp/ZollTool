import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AdminLogEntry, TokenResponse } from '@zolltool/shared';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let dataDir: string;
let owner: TokenResponse;
let alice: TokenResponse;

beforeAll(async () => {
  process.env.REGISTRATION_OPEN = '1';
  process.env.OWNER_EMAIL = 'owner@logs-test.com';
  process.env.OWNER_PASSWORD = 'owner-secret-pw';
  dataDir = mkdtempSync(join(tmpdir(), 'zolltool-logs-'));
  app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret' });

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'owner@logs-test.com', password: 'owner-secret-pw' },
  });
  owner = login.json();

  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'alice@logs-test.com', password: 'password123', accountName: 'Alice Corp' },
  });
  alice = reg.json();
});

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('diagnostic log upload + admin download', () => {
  it('rejects an unauthenticated upload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/logs',
      payload: { deviceId: 'dev-a', log: 'hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a malformed upload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/logs',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { deviceId: 'dev-a' }, // missing required `log`
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts an authenticated upload and lists it for the owner', async () => {
    const up = await app.inject({
      method: 'POST',
      url: '/api/logs',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: {
        deviceId: 'carbon-terminal-1',
        deviceName: 'Front register',
        flavor: 'carbon',
        appVersion: '2026-07-24 09:00',
        reason: 'payment-failed',
        log: '[2026-07-24T09:00:00.000Z] ERROR CarbonPayment result approved=false error=Payment cancelled',
      },
    });
    expect(up.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/logs',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(list.statusCode).toBe(200);
    const entries = list.json() as AdminLogEntry[];
    const entry = entries.find((e) => e.deviceId === 'carbon-terminal-1');
    expect(entry).toBeDefined();
    expect(entry!.accountName).toBe('Alice Corp');
    expect(entry!.flavor).toBe('carbon');
    expect(entry!.reason).toBe('payment-failed');
    expect(entry!.size).toBeGreaterThan(0);
  });

  it('non-owners cannot list or download logs', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/logs',
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(list.statusCode).toBe(403);
  });

  it('lets the owner download an uploaded log', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/logs',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    const [entry] = list.json() as AdminLogEntry[];

    const dl = await app.inject({
      method: 'GET',
      url: `/api/admin/logs/${entry.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toContain('text/plain');
    expect(dl.body).toContain('Payment cancelled');
  });

  it('404s an unknown log id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/logs/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
