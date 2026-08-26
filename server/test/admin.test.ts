import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AdminAccount, AdminAccountDetail, AdminMetricRow, AdminOverview, TokenResponse, WireOp } from '@zolltool/shared';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let dataDir: string;
let owner: TokenResponse;
let alice: TokenResponse;

beforeAll(async () => {
  process.env.REGISTRATION_OPEN = '1';
  process.env.REQUIRE_CAPTCHA = '0';
  process.env.OWNER_EMAIL = 'owner@admin-test.com';
  process.env.OWNER_PASSWORD = 'owner-secret-pw';
  dataDir = mkdtempSync(join(tmpdir(), 'zolltool-admin-'));
  app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret' });

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'owner@admin-test.com', password: 'owner-secret-pw' },
  });
  owner = login.json();

  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'alice@admin-test.com', password: 'password123', accountName: 'Alice Corp' },
  });
  alice = reg.json();

  const ops: WireOp[] = [
    { opId: 'admin-op-1'.padEnd(16, '0'), deviceId: 'dev-a', ts: Date.now(), type: 'tx.create', payload: {} },
    { opId: 'admin-op-2'.padEnd(16, '0'), deviceId: 'dev-a', ts: Date.now(), type: 'product.upsert', payload: {} },
  ];
  await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { deviceId: 'dev-a', deviceName: 'Alice tablet', ops },
  });
});

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('admin routes', () => {
  it('rejects non-owners on every admin endpoint', async () => {
    for (const url of ['/api/admin/overview', '/api/admin/accounts', '/api/admin/metrics']) {
      const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${alice.accessToken}` } });
      expect(res.statusCode).toBe(403);
      const anon = await app.inject({ method: 'GET', url });
      expect(anon.statusCode).toBe(401);
    }
  });

  it('reports overview totals', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/overview',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const o = res.json() as AdminOverview;
    expect(o.accounts).toBe(2); // owner + alice
    expect(o.users).toBe(2);
    expect(o.ops).toBe(2);
    expect(o.transactions).toBe(1);
    expect(o.activeToday).toBeGreaterThanOrEqual(1);
  });

  it('lists accounts with per-account aggregates and detail', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/accounts',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    const accounts = res.json() as AdminAccount[];
    const aliceAccount = accounts.find((a) => a.name === 'Alice Corp')!;
    expect(aliceAccount.userCount).toBe(1);
    expect(aliceAccount.deviceCount).toBe(1);
    expect(aliceAccount.opCount).toBe(2);
    expect(aliceAccount.txTotal).toBe(1);
    expect(aliceAccount.lastActivityAt).toBeGreaterThan(0);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/admin/accounts/${aliceAccount.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    const d = detail.json() as AdminAccountDetail;
    expect(d.users[0].email).toBe('alice@admin-test.com');
    expect(d.devices[0].name).toBe('Alice tablet');
  });

  it('returns per-day metric rows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/metrics?days=7',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    const rows = res.json() as AdminMetricRow[];
    const aliceRow = rows.find((r) => r.accountName === 'Alice Corp')!;
    expect(aliceRow.opsReceived).toBe(2);
    expect(aliceRow.txCount).toBe(1);
    expect(aliceRow.logins).toBeGreaterThanOrEqual(1);
  });
});
