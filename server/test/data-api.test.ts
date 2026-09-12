import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { EventStock, SalesEvent, TokenResponse, Transaction, WireOp } from '@zolltool/shared';
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

function stockOp(opId: string, payload: unknown): WireOp {
  return { opId: opId.padEnd(16, 'z'), deviceId: DEV, ts: Date.now(), type: 'stock.set', payload };
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
    // Assigned stock for ev1: a plain product, one variant, and a later LWW bump.
    // Explicit opIds — the shared op() helper's zero-padding collapses op-10 →
    // op-1…, colliding with earlier ops so the deduped push would drop them.
    stockOp('stk-p1-a', { eventId: 'ev1', productId: 'p1', variantId: '', broughtQty: 10, updatedAt: 100 }),
    stockOp('stk-p1-b', { eventId: 'ev1', productId: 'p1', variantId: '', broughtQty: 25, updatedAt: 300 }),
    stockOp('stk-p2', { eventId: 'ev1', productId: 'p2', variantId: 'v-a', broughtQty: 8, updatedAt: 100 }),
    stockOp('stk-ev2', { eventId: 'ev2', productId: 'p1', variantId: '', broughtQty: 5, updatedAt: 100 }),
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

  it("materializes an event's assigned stock (LWW; scoped to the event)", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data/events/ev1/stock', headers: auth() });
    expect(res.statusCode).toBe(200);
    const stock = res.json() as EventStock[];
    const byKey = Object.fromEntries(stock.map((s) => [`${s.productId}:${s.variantId}`, s.broughtQty]));
    expect(byKey).toEqual({ 'p1:': 25, 'p2:v-a': 8 }); // later updatedAt (25) wins; ev2 excluded
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

  it('remaps sale lines of merged products through product.merge', async () => {
    // Reuse ev2 (existing, active) so we don't disturb the event-set assertions.
    const t = Date.parse('2025-07-01T10:00:00Z');
    const item = { pid: 'pm-a', vid: null, title: 'Blue', qty: 2, unitPrice: 5, lineTotal: 10 };
    const merged = { ...tx('tm-1', 'ev2', t, 10), items: [item] };
    // Explicit opIds — the shared `op()` helper's zero-padding can collapse
    // distinct counters (op-10 → op-1…) and collide with earlier ops.
    const wire = (opId: string, type: WireOp['type'], payload: unknown): WireOp => ({
      opId: opId.padEnd(16, 'z'),
      deviceId: DEV,
      ts: Date.now(),
      type,
      payload,
    });
    const push = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: auth(),
      payload: {
        deviceId: DEV,
        ops: [
          wire('merge-tx-tm1', 'tx.create', merged),
          wire('merge-op-mrgapi', 'product.merge', {
            id: 'mrg-api',
            intoId: 'pm-x',
            updatedAt: 500,
            sources: [{ fromKey: 'pm-a', toPid: 'pm-x', toVid: 'v-a', title: 'Colour Pin', variantLabel: 'Blue' }],
          }),
        ],
      },
    });
    expect(push.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: '/api/data/events/ev2/transactions', headers: auth() });
    const mergedTx = (res.json() as Transaction[]).find((x) => x.id === 'tm-1')!;
    const line = mergedTx.items[0]!;
    expect([line.pid, line.vid, line.title, line.variantLabel]).toEqual(['pm-x', 'v-a', 'Colour Pin', 'Blue']);
    // Money/qty are untouched by the remap.
    expect(line.qty).toBe(2);
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

    // A revoked token can then be permanently purged from the list.
    const purge = await app.inject({ method: 'DELETE', url: `/api/tokens/${id}/purge`, headers: auth() });
    expect(purge.statusCode).toBe(200);
    expect((purge.json() as { deleted: boolean }).deleted).toBe(true);
    const list = await app.inject({ method: 'GET', url: '/api/tokens', headers: auth() });
    expect((list.json() as { id: string }[]).some((t) => t.id === id)).toBe(false);
  });

  it('refuses to purge a token that is still active (must revoke first)', async () => {
    const mint = await app.inject({ method: 'POST', url: '/api/tokens', headers: auth(), payload: { name: 'live' } });
    const { id } = mint.json() as { id: string };
    const purge = await app.inject({ method: 'DELETE', url: `/api/tokens/${id}/purge`, headers: auth() });
    expect(purge.statusCode).toBe(404);
    // Still listed and usable until revoked.
    const list = await app.inject({ method: 'GET', url: '/api/tokens', headers: auth() });
    expect((list.json() as { id: string }[]).some((t) => t.id === id)).toBe(true);
  });
});
