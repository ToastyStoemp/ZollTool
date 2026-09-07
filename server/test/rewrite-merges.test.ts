import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { TokenResponse, WireOp } from '@zolltool/shared';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let dataDir: string;
let acct: TokenResponse;

const DEV = 'dev-rw';
const wire = (opId: string, type: WireOp['type'], payload: unknown): WireOp => ({
  opId: opId.padEnd(16, 'z'),
  deviceId: DEV,
  ts: Date.now(),
  type,
  payload,
});

beforeAll(async () => {
  process.env.REGISTRATION_OPEN = '1';
  process.env.REQUIRE_CAPTCHA = '0';
  dataDir = mkdtempSync(join(tmpdir(), 'zolltool-rewrite-'));
  app = await buildApp({ dataDir, jwtSecret: 'test-secret-test-secret' });
  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'rw@test.com', password: 'password123', accountName: 'RW' },
  });
  acct = reg.json();

  // A sale of source product "pm-a", plus the merge folding pm-a → pm-x / v-a.
  const ops: WireOp[] = [
    wire('rw-ev', 'event.upsert', {
      id: 'ev1', name: 'E', venue: {}, currency: 'EUR', status: 'active', updatedAt: 1,
    }),
    wire('rw-tx', 'tx.create', {
      id: 't1', eventId: 'ev1', deviceId: DEV, timestamp: 1, method: 'cash',
      payments: [], discounts: [], total: 10, currency: 'EUR',
      items: [{ pid: 'pm-a', vid: null, title: 'Blue', qty: 2, unitPrice: 5, lineTotal: 10 }],
    }),
    wire('rw-stk', 'stock.set', { eventId: 'ev1', productId: 'pm-a', variantId: '', broughtQty: 7, updatedAt: 1 }),
    wire('rw-mrg', 'product.merge', {
      id: 'mrg', intoId: 'pm-x', updatedAt: 5,
      sources: [{ fromKey: 'pm-a', toPid: 'pm-x', toVid: 'v-a', title: 'Pin', variantLabel: 'Blue' }],
    }),
  ];
  const push = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    headers: { authorization: `Bearer ${acct.accessToken}` },
    payload: { deviceId: DEV, ops },
  });
  expect(push.statusCode).toBe(200);
  await app.close(); // release the DB file before the script opens it
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('rewrite-merges migration', () => {
  it('bakes the merge into stored payloads, drops the merge op, and bumps the epoch', () => {
    const dbFile = join(dataDir, 'zolltool.db');
    const out = execFileSync(
      process.execPath,
      ['scripts/rewrite-merges.mjs', '--db', dbFile, '--account', acct.user.accountId, '--apply'],
      { encoding: 'utf8' },
    );
    expect(out).toMatch(/APPLIED/);

    const db = new Database(dbFile);
    const txRow = db.prepare("SELECT payload FROM ops WHERE type = 'tx.create'").get() as { payload: string };
    const item = JSON.parse(txRow.payload).items[0];
    expect([item.pid, item.vid, item.title, item.variantLabel]).toEqual(['pm-x', 'v-a', 'Pin', 'Blue']);
    expect(item.qty).toBe(2); // money/qty untouched

    const stockRow = db.prepare("SELECT payload FROM ops WHERE type = 'stock.set'").get() as { payload: string };
    const stock = JSON.parse(stockRow.payload);
    expect([stock.productId, stock.variantId]).toEqual(['pm-x', 'v-a']);

    const mergeCount = (db.prepare("SELECT COUNT(*) AS n FROM ops WHERE type = 'product.merge'").get() as { n: number }).n;
    expect(mergeCount).toBe(0); // removed (no --keep-merge-tombstone)

    const epoch = (db.prepare('SELECT syncEpoch FROM accounts WHERE id = ?').get(acct.user.accountId) as { syncEpoch: number }).syncEpoch;
    expect(epoch).toBeGreaterThan(0);
    db.close();
  });
});
