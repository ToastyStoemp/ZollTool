import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { SalesEvent, TokenResponse, Transaction, WireOp } from '@zolltool/shared';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let dataDir: string;
let alice: TokenResponse;

const DEV = 'dev-1';
let opN = 0;
function op(type: WireOp['type'], payload: unknown): WireOp {
  opN += 1;
  return { opId: `op-${opN}`.padEnd(16, '0'), deviceId: DEV, ts: Date.now(), type, payload };
}

function event(id: string, updatedAt: number, extra: Partial<SalesEvent> = {}): SalesEvent {
  return {
    id,
    name: `Event ${id}`,
    dateStart: '2024-12-17',
    dateEnd: '2024-12-20',
    venue: { country: 'Germany' },
    currency: 'EUR',
    status: 'active',
    updatedAt,
    ...extra,
  };
}

function tx(id: string, eventId: string, timestamp: number, total: number): Transaction {
  return {
    id,
    eventId,
    deviceId: DEV,
    timestamp,
    method: 'card',
    payments: [{ kind: 'card', amount: total }],
    items: [],
    discounts: [],
    total,
    currency: 'EUR',
  };
}

beforeAll(async () => {
  process.env.REGISTRATION_OPEN = '1';
  process.env.REQUIRE_CAPTCHA = '0';
  dataDir = mkdtempSync(join(tmpdir(), 'zolltool-data-api-'));
  app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret' });

  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'alice@data-test.com', password: 'password123', accountName: 'Alice' },
  });
  alice = reg.json();

  const t0 = Date.parse('2024-12-18T10:00:00Z');
  const ops: WireOp[] = [
    op('event.upsert', event('ev1', 100)),
    op('event.upsert', event('ev2', 100)),
    op('event.close', { eventId: 'ev1', updatedAt: 200 }),
    op('event.upsert', event('ev3', 100, { deletedAt: 150 })), // soft-deleted → excluded
    op('tx.create', tx('t1', 'ev1', t0, 68.05)),
    op('tx.create', tx('t2', 'ev1', t0 + 3600_000, 41.06)),
    op('tx.create', tx('t3', 'ev2', Date.parse('2025-06-01T10:00:00Z'), 10)),
    op('tx.revert', { txId: 't2', revertedAt: t0 + 7200_000 }),
  ];
  const push = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    headers: { authorization: `Bearer ${alice.accessToken}` },
    payload: { deviceId: DEV, ops },
  });
  expect(push.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const auth = () => ({ authorization: `Bearer ${alice.accessToken}` });

describe('data read API', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data/events' });
    expect(res.statusCode).toBe(401);
  });

  it('materializes current events (closed applied, soft-deleted excluded)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data/events', headers: auth() });
    const events = res.json() as SalesEvent[];
    const byId = Object.fromEntries(events.map((e) => [e.id, e]));
    expect(Object.keys(byId).sort()).toEqual(['ev1', 'ev2']);
    expect(byId.ev1.status).toBe('closed'); // event.close applied
  });

  it("returns an event's transactions with reverts marked", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data/events/ev1/transactions', headers: auth() });
    const txns = res.json() as Transaction[];
    expect(txns.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    const t2 = txns.find((t) => t.id === 't2')!;
    expect(t2.revertedBy).toBeTruthy();
    expect(t2.revertedAt).toBeTruthy();
  });

  it('windows transactions by timestamp', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/data/transactions?from=2024-12-01&to=2024-12-31',
      headers: auth(),
    });
    const txns = res.json() as Transaction[];
    // t1 + t2 are in December; t3 (June 2025) is outside the window.
    expect(txns.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('isolates accounts', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'bob@data-test.com', password: 'password123', accountName: 'Bob' },
    });
    const bob = reg.json() as TokenResponse;
    const res = await app.inject({
      method: 'GET',
      url: '/api/data/events',
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(res.json()).toEqual([]);
  });

  it('reads via a scoped API token, and stops after revoke', async () => {
    // Mint a read-only token for Alice's account.
    const mint = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: auth(),
      payload: { name: 'ZollTax' },
    });
    expect(mint.statusCode).toBe(200);
    const { id, token, scopes } = mint.json() as { id: string; token: string; scopes: string };
    expect(token).toMatch(/^zt_/);
    expect(scopes).toBe('data:read');

    // The token reads the same account data as the JWT.
    const withToken = await app.inject({
      method: 'GET',
      url: '/api/data/events',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(withToken.statusCode).toBe(200);
    expect((withToken.json() as SalesEvent[]).map((e) => e.id).sort()).toEqual(['ev1', 'ev2']);

    // A token cannot mint tokens (no JWT identity) — read-only surface only.
    const badMint = await app.inject({ method: 'POST', url: '/api/tokens', headers: { authorization: `Bearer ${token}` } });
    expect(badMint.statusCode).toBe(401);

    // Revoke → the token stops working.
    const del = await app.inject({ method: 'DELETE', url: `/api/tokens/${id}`, headers: auth() });
    expect(del.statusCode).toBe(200);
    const afterRevoke = await app.inject({
      method: 'GET',
      url: '/api/data/events',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });
});
