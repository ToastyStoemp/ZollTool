import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Product, SalesEvent, ServerOp, Transaction } from '@zolltool/shared';
import { db } from '@/db/schema';
import { applyRemoteOps } from '../apply';

const OWN_DEVICE = 'dev-me';
const OTHER_DEVICE = 'dev-other';

let seq = 0;
function op(type: ServerOp['type'], payload: unknown, deviceId = OTHER_DEVICE): ServerOp {
  seq++;
  return { serverSeq: seq, opId: `op-${seq}`.padEnd(16, '0'), deviceId, ts: Date.now(), type, payload };
}

function makeTx(id: string): Transaction {
  return {
    id,
    eventId: 'ev-1',
    deviceId: OTHER_DEVICE,
    timestamp: Date.now(),
    method: 'cash',
    payments: [{ kind: 'cash', amount: 10 }],
    items: [{ pid: 'p1', vid: null, title: 'Print', qty: 1, unitPrice: 10, lineTotal: 10 }],
    discounts: [],
    total: 10,
    currency: 'CHF',
  };
}

function makeProduct(id: string, title: string, updatedAt: number): Product {
  return { id, title, forSale: true, unlisted: false, price: 10, variants: [], sortOrder: 0, updatedAt };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('applyRemoteOps', () => {
  it('inserts foreign transactions once and skips own ops', async () => {
    const tx = makeTx('tx-1');
    await applyRemoteOps([op('tx.create', tx)], OWN_DEVICE);
    await applyRemoteOps([op('tx.create', tx)], OWN_DEVICE); // replay
    expect(await db.transactions.count()).toBe(1);

    const ownTx = makeTx('tx-own');
    await applyRemoteOps([op('tx.create', ownTx, OWN_DEVICE)], OWN_DEVICE);
    expect(await db.transactions.get('tx-own')).toBeUndefined();
  });

  it('applies reverts exactly once', async () => {
    await applyRemoteOps([op('tx.create', makeTx('tx-2'))], OWN_DEVICE);
    const revert = op('tx.revert', { txId: 'tx-2', revertedAt: 123 });
    await applyRemoteOps([revert], OWN_DEVICE);
    const after = await db.transactions.get('tx-2');
    expect(after?.revertedBy).toBe(revert.opId);

    // A second (different) revert op must not overwrite the marker.
    await applyRemoteOps([op('tx.revert', { txId: 'tx-2', revertedAt: 456 })], OWN_DEVICE);
    expect((await db.transactions.get('tx-2'))?.revertedBy).toBe(revert.opId);
  });

  it('resolves product conflicts by last-writer-wins on updatedAt', async () => {
    await applyRemoteOps([op('product.upsert', makeProduct('p1', 'New name', 2000))], OWN_DEVICE);
    await applyRemoteOps([op('product.upsert', makeProduct('p1', 'Stale name', 1000))], OWN_DEVICE);
    expect((await db.products.get('p1'))?.title).toBe('New name');

    await applyRemoteOps([op('product.upsert', makeProduct('p1', 'Newest name', 3000))], OWN_DEVICE);
    expect((await db.products.get('p1'))?.title).toBe('Newest name');
  });

  it('applies event close only when newer', async () => {
    const event: SalesEvent = {
      id: 'ev-1',
      name: 'Con',
      venue: {},
      currency: 'CHF',
      status: 'active',
      updatedAt: 2000,
    };
    await applyRemoteOps([op('event.upsert', event)], OWN_DEVICE);
    await applyRemoteOps([op('event.close', { eventId: 'ev-1', updatedAt: 1000 })], OWN_DEVICE);
    expect((await db.events.get('ev-1'))?.status).toBe('active');
    await applyRemoteOps([op('event.close', { eventId: 'ev-1', updatedAt: 3000 })], OWN_DEVICE);
    expect((await db.events.get('ev-1'))?.status).toBe('closed');
  });

  it('LWWs stock rows on the compound key', async () => {
    const row = { eventId: 'ev-1', productId: 'p1', variantId: '', broughtQty: 50, updatedAt: 2000 };
    await applyRemoteOps([op('stock.set', row)], OWN_DEVICE);
    await applyRemoteOps([op('stock.set', { ...row, broughtQty: 10, updatedAt: 1000 })], OWN_DEVICE);
    expect((await db.eventStock.get(['ev-1', 'p1', '']))?.broughtQty).toBe(50);
  });

  it('stores thumbnail placeholders from image.meta and requests the full image', async () => {
    const thumbB64 = btoa('fake-webp-bytes');
    const want = await applyRemoteOps(
      [op('image.meta', { imageId: 'img-1', productId: 'p1', updatedAt: 1, thumbB64 })],
      OWN_DEVICE,
    );
    expect(want).toEqual(['img-1']);
    const rec = await db.images.get('img-1');
    expect(rec).toBeTruthy();
    expect(rec!.full.size).toBeGreaterThan(0);

    // Replay must not re-request the image.
    const again = await applyRemoteOps(
      [op('image.meta', { imageId: 'img-1', productId: 'p1', updatedAt: 1, thumbB64 })],
      OWN_DEVICE,
    );
    expect(again).toEqual([]);
  });
});
