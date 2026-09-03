import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { PullResponse, PushResponse, TokenResponse, WireOp } from '@zolltool/shared';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let dataDir: string;
let owner: TokenResponse; // account admin (first user)
let helper: TokenResponse; // restricted member (events E1 only, then +E2)

const opId = (s: string) => s.padEnd(16, '0');
function push(token: string, ops: WireOp[]) {
  return app.inject({ method: 'POST', url: '/api/sync/push', headers: { authorization: `Bearer ${token}` }, payload: { deviceId: 'd1', ops } });
}
function pull(token: string) {
  return app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: { authorization: `Bearer ${token}` } });
}
const wire = (id: string, type: WireOp['type'], payload: unknown): WireOp => ({ opId: opId(id), deviceId: 'd1', ts: Date.now(), type, payload });

beforeAll(async () => {
  process.env.REGISTRATION_OPEN = '1';
  process.env.REQUIRE_CAPTCHA = '0';
  process.env.OWNER_EMAIL = 'srv@owner.test';
  process.env.OWNER_PASSWORD = 'owner-secret-pw';
  dataDir = mkdtempSync(join(tmpdir(), 'zolltool-helper-'));
  app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret-xx' });

  owner = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'boss@acme.test', password: 'password123', accountName: 'Acme' } })).json();

  // Two events, a catalog product, and a transaction + stock for each event.
  await push(owner.accessToken, [
    wire('ev1', 'event.upsert', { id: 'E1', name: 'Con One', updatedAt: 1 }),
    wire('ev2', 'event.upsert', { id: 'E2', name: 'Con Two', updatedAt: 1 }),
    wire('prod1', 'product.upsert', { id: 'p1', title: 'Pin', price: 1200, updatedAt: 1, variants: [] }),
    wire('tx1', 'tx.create', { id: 'T1', eventId: 'E1', total: 1200, updatedAt: 1 }),
    wire('tx2', 'tx.create', { id: 'T2', eventId: 'E2', total: 900, updatedAt: 1 }),
    wire('stk1', 'stock.set', { eventId: 'E1', productId: 'p1', variantId: '', broughtQty: 10, updatedAt: 1 }),
    wire('stk2', 'stock.set', { eventId: 'E2', productId: 'p1', variantId: '', broughtQty: 5, updatedAt: 1 }),
  ]);
});

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('helper event isolation', () => {
  it('creates a helper invite bound to E1 and registers the helper', async () => {
    const inv = await app.inject({ method: 'POST', url: '/api/invites', headers: { authorization: `Bearer ${owner.accessToken}` }, payload: { allowedEventIds: ['E1'] } });
    expect(inv.statusCode).toBe(200);
    const { code } = inv.json() as { code: string };
    helper = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'help@acme.test', password: 'password123', inviteCode: code } })).json();
    expect(helper.user.accountId).toBe(owner.user.accountId);
    expect(helper.user.role).toBe('member');
    expect(helper.user.allowedEventIds).toEqual(['E1']);
  });

  it('spends an invite code only once', async () => {
    const inv = await app.inject({ method: 'POST', url: '/api/invites', headers: { authorization: `Bearer ${owner.accessToken}` }, payload: { allowedEventIds: ['E1'] } });
    const { code } = inv.json() as { code: string };
    const first = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'reuse1@acme.test', password: 'password123', inviteCode: code } });
    expect(first.statusCode).toBe(200);
    expect((first.json() as TokenResponse).user.accountId).toBe(owner.user.accountId);

    // A second use of the same code must never join the account again — it's spent.
    const second = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'reuse2@acme.test', password: 'password123', inviteCode: code } });
    if (second.statusCode === 200) {
      // Open-registration mode: falls through to a brand-new standalone account.
      const u = (second.json() as TokenResponse).user;
      expect(u.accountId).not.toBe(owner.user.accountId);
      expect(u.allowedEventIds ?? []).toEqual([]);
    } else {
      // Invite-only mode: rejected outright.
      expect(second.statusCode).toBe(403);
    }
  });

  it('lists invite codes with status and revokes them (admins only)', async () => {
    const mk = async () =>
      ((await app.inject({ method: 'POST', url: '/api/invites', headers: { authorization: `Bearer ${owner.accessToken}` }, payload: { allowedEventIds: ['E1'] } })).json() as { code: string }).code;
    const usedCode = await mk();
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'listed@acme.test', password: 'password123', inviteCode: usedCode } });
    const openCode = await mk();

    const listRes = await app.inject({ method: 'GET', url: '/api/invites', headers: { authorization: `Bearer ${owner.accessToken}` } });
    expect(listRes.statusCode).toBe(200);
    const { invites } = listRes.json() as { invites: { code: string; used: boolean; usedByEmail: string | null }[] };
    expect(invites.find((i) => i.code === usedCode)).toMatchObject({ used: true, usedByEmail: 'listed@acme.test' });
    expect(invites.find((i) => i.code === openCode)?.used).toBe(false);

    // A member (helper) can't list invites.
    expect((await app.inject({ method: 'GET', url: '/api/invites', headers: { authorization: `Bearer ${helper.accessToken}` } })).statusCode).toBe(403);

    // Delete the unused code — it disappears from the list.
    const del = await app.inject({ method: 'DELETE', url: `/api/invites/${openCode}`, headers: { authorization: `Bearer ${owner.accessToken}` } });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { deleted: number }).deleted).toBe(1);
    const after = ((await app.inject({ method: 'GET', url: '/api/invites', headers: { authorization: `Bearer ${owner.accessToken}` } })).json() as { invites: { code: string }[] }).invites;
    expect(after.some((i) => i.code === openCode)).toBe(false);
  });

  it('only syncs the catalog + E1 data to the helper (never E2)', async () => {
    const body = (await pull(helper.accessToken)).json() as PullResponse;
    const dump = body.ops.map((o) => JSON.stringify(o.payload)).join('|');
    const eventIds = body.ops.filter((o) => o.type === 'event.upsert').map((o) => (o.payload as { id: string }).id);
    const txEvents = body.ops.filter((o) => o.type === 'tx.create').map((o) => (o.payload as { eventId: string }).eventId);
    expect(eventIds).toEqual(['E1']);
    expect(txEvents).toEqual(['E1']);
    expect(body.ops.some((o) => o.type === 'product.upsert')).toBe(true); // catalog is shared
    expect(dump).not.toContain('E2');
  });

  it('owner sees everything (unrestricted)', async () => {
    const body = (await (pull(owner.accessToken) as unknown as Promise<{ json(): PullResponse }>)).json();
    const eventIds = body.ops.filter((o) => o.type === 'event.upsert').map((o) => (o.payload as { id: string }).id).sort();
    expect(eventIds).toEqual(['E1', 'E2']);
  });

  it('lets the helper record a sale/stock for E1 but silently drops E2, catalog and discount writes', async () => {
    const okTx = await push(helper.accessToken, [wire('htx1', 'tx.create', { id: 'HT1', eventId: 'E1', total: 500, updatedAt: 2 })]);
    expect(okTx.statusCode).toBe(200);
    expect((okTx.json() as PushResponse).accepted).toBe(1);

    const okStock = await push(helper.accessToken, [wire('hstk1', 'stock.set', { eventId: 'E1', productId: 'p1', variantId: '', broughtQty: 8, updatedAt: 2 })]);
    expect(okStock.statusCode).toBe(200);

    // Disallowed ops are DROPPED, not 403'd (a 403 would wedge the client offline).
    // The push succeeds with accepted:0 and the op is never stored.
    const badEvent = await push(helper.accessToken, [wire('htx2', 'tx.create', { id: 'HT2', eventId: 'E2', total: 1, updatedAt: 2 })]);
    expect(badEvent.statusCode).toBe(200);
    expect((badEvent.json() as PushResponse).accepted).toBe(0);

    const badCatalog = await push(helper.accessToken, [wire('hp1', 'product.upsert', { id: 'p1', title: 'Hacked', price: 1, updatedAt: 2, variants: [] })]);
    expect(badCatalog.statusCode).toBe(200);
    expect((badCatalog.json() as PushResponse).accepted).toBe(0);

    const badDiscount = await push(helper.accessToken, [wire('hd1', 'discount.upsert', { id: 'd1', type: 'tiered', updatedAt: 2 })]);
    expect(badDiscount.statusCode).toBe(200);
    expect((badDiscount.json() as PushResponse).accepted).toBe(0);

    // The owner never receives the dropped ops, and the catalog is untouched.
    const ownerView = (await pull(owner.accessToken)).json() as PullResponse;
    expect(ownerView.ops.some((o) => o.type === 'tx.create' && (o.payload as { id: string }).id === 'HT2')).toBe(false);
    const hacked = ownerView.ops.find((o) => o.type === 'product.upsert' && (o.payload as { title: string }).title === 'Hacked');
    expect(hacked).toBeUndefined();
  });

  it('exposes the up-to-date allowedEventIds via /api/auth/me (no re-login needed)', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${helper.accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { allowedEventIds: string[] } }).user.allowedEventIds).toEqual(['E1']);
  });

  it('can add and remove events from a helper', async () => {
    // add E2
    const add = await app.inject({ method: 'PUT', url: `/api/users/${helper.user.id}/events`, headers: { authorization: `Bearer ${owner.accessToken}` }, payload: { allowedEventIds: ['E1', 'E2'] } });
    expect(add.statusCode).toBe(200);
    let body = (await (pull(helper.accessToken) as unknown as Promise<{ json(): PullResponse }>)).json();
    let eventIds = body.ops.filter((o) => o.type === 'event.upsert').map((o) => (o.payload as { id: string }).id).sort();
    expect(eventIds).toEqual(['E1', 'E2']);

    // remove back to E2 only
    const rm = await app.inject({ method: 'PUT', url: `/api/users/${helper.user.id}/events`, headers: { authorization: `Bearer ${owner.accessToken}` }, payload: { allowedEventIds: ['E2'] } });
    expect(rm.statusCode).toBe(200);
    body = (await (pull(helper.accessToken) as unknown as Promise<{ json(): PullResponse }>)).json();
    eventIds = body.ops.filter((o) => o.type === 'event.upsert').map((o) => (o.payload as { id: string }).id).sort();
    expect(eventIds).toEqual(['E2']);
  });
});
