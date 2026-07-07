import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../schema';
import { importV1State } from '../migrate-v1';
import { recordTransaction, revertTransaction, setSetting } from '../repo';
import { importBackup } from '@/lib/export/backup-json';
import { uuidv7 } from '@/lib/uuid';
import type { Transaction } from '@zolltool/shared';

// Realistic v1 blob shaped like reference/WorkingData.json / pos.html output.
const V1_STATE = {
  meta: {
    event: 'Fantasy Basel 2026',
    eventDateStart: '2026-05-14',
    eventDateEnd: '2026-05-16',
    venueStreet: 'Messeplatz 10',
    venuePostcode: '4005',
    venueCity: 'Basel',
    venueCountry: 'Switzerland',
    venueTIN: 'CHE222251936',
    currency: 'CHF',
  },
  artist: { companyName: 'GET UP GAMES' },
  edec: { transportMode: 'road' },
  form1174: { groupMode: 'auto', assignments: [] },
  products: [
    {
      id: 'p-print',
      title: 'Art Print A3',
      sku: 'PRINT-A3',
      type: 'Prints',
      amount: 50,
      weightG: 120,
      price: '25',
      soldQty: 3,
      soldValue: 75,
      variants: [],
    },
    {
      id: 'p-shirt',
      title: 'T-Shirt',
      type: 'Apparel',
      price: '35',
      totalValueCHF: null,
      variants: [
        { id: 'v-s', name: 'S', sku: 'TS-S', amount: 10, soldQty: 1, soldValue: 35 },
        { id: 'v-m', name: 'M', sku: 'TS-M', amount: 15, price: 38 },
      ],
    },
    // totalValueCHF override: unit price should become 200/10 = 20, not 22
    { id: 'p-book', title: 'Artbook', amount: 10, price: '22', totalValueCHF: 200, variants: [] },
  ],
  transactions: [
    {
      id: 'tx-1',
      timestamp: 1770000000000,
      method: 'cash',
      payments: [{ method: 'cash', amount: 50 }],
      total: 50,
      currency: 'CHF',
      discounts: [],
      reverted: false,
      revertedAt: null,
      items: [{ pid: 'p-print', vid: null, title: 'Art Print A3', variantLabel: null, qty: 2, unitPrice: 25, lineTotal: 50 }],
    },
    {
      id: 'tx-2',
      timestamp: 1770000100000,
      method: 'split',
      payments: [
        { method: 'cash', amount: 20 },
        { method: 'card', amount: 15 },
      ],
      total: 35,
      currency: 'CHF',
      discounts: [{ name: '10% off', amount: 3.5, custom: true }],
      reverted: true,
      revertedAt: 1770000200000,
      items: [{ pid: 'p-shirt', vid: 'v-s', title: 'T-Shirt', variantLabel: 'S', qty: 1, unitPrice: 35, lineTotal: 35 }],
    },
  ],
  discounts: [
    {
      id: 'd-1',
      name: '3 for 60',
      type: 'tiered',
      productIds: ['p-print'],
      tiers: [{ qty: 3, total: 60 }],
      tierContinue: false,
    },
  ],
};

let eventId: string;

beforeAll(async () => {
  await setSetting('deviceId', 'test-device');
  eventId = await importV1State(V1_STATE as any, 'test-device');
});

describe('importV1State', () => {
  it('creates one active event carrying the customs blob', async () => {
    const events = await db.events.toArray();
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.id).toBe(eventId);
    expect(e.name).toBe('Fantasy Basel 2026');
    expect(e.status).toBe('active');
    expect(e.currency).toBe('CHF');
    expect(e.venue.tin).toBe('CHE222251936');
    expect((e.customs as any).edec.transportMode).toBe('road');
  });

  it('imports products with v1 price semantics (totalValueCHF override)', async () => {
    const book = await db.products.get('p-book');
    expect(book!.price).toBe(20); // 200 / 10, not the 22 label price
    const print = await db.products.get('p-print');
    expect(print!.price).toBe(25);
    const shirt = await db.products.get('p-shirt');
    expect(shirt!.variants).toHaveLength(2);
    expect(shirt!.variants[1]!.price).toBe(38);
  });

  it('maps v1 amounts to per-event stock (variant-level where present)', async () => {
    expect((await db.eventStock.get([eventId, 'p-print', '']))!.broughtQty).toBe(50);
    expect((await db.eventStock.get([eventId, 'p-shirt', 'v-s']))!.broughtQty).toBe(10);
    expect((await db.eventStock.get([eventId, 'p-shirt', 'v-m']))!.broughtQty).toBe(15);
  });

  it('imports transactions scoped to the event, preserving reverts and split legs', async () => {
    const tx1 = await db.transactions.get('tx-1');
    expect(tx1!.eventId).toBe(eventId);
    expect(tx1!.revertedBy).toBeUndefined();
    const tx2 = await db.transactions.get('tx-2');
    expect(tx2!.revertedBy).toBe('v1-import');
    expect(tx2!.payments).toEqual([
      { kind: 'cash', amount: 20 },
      { kind: 'card', amount: 15 },
    ]);
  });

  it('imports discount rules', async () => {
    const d = await db.discounts.get('d-1');
    expect(d!.type).toBe('tiered');
    expect(d!.tiers).toEqual([{ qty: 3, total: 60 }]);
  });

  it('sets the imported event active', async () => {
    expect((await db.settings.get('activeEventId'))!.value).toBe(eventId);
  });
});

describe('importBackup with a legacy v1 JSON file', () => {
  it('detects the v1 shape and imports it as a new event', async () => {
    const eventsBefore = await db.events.count();
    const opsBefore = await db.ops.count();
    const counts = await importBackup(JSON.stringify(V1_STATE));
    expect(counts.events).toBe(1);
    expect(counts.products).toBe(3);
    expect(counts.transactions).toBe(2);
    // A fresh event is created; products merge by id instead of duplicating
    expect(await db.events.count()).toBe(eventsBefore + 1);
    expect(await db.products.count()).toBe(3);
    // Imports queue sync ops so the data reaches the server and other devices
    const newOps = (await db.ops.toArray()).slice(opsBefore);
    expect(newOps.every((o) => o.synced === 0)).toBe(true);
    expect(newOps.filter((o) => o.type === 'event.upsert')).toHaveLength(1);
    expect(newOps.filter((o) => o.type === 'product.upsert')).toHaveLength(3);
    expect(newOps.filter((o) => o.type === 'tx.create')).toHaveLength(2);
    expect(newOps.filter((o) => o.type === 'stock.set')).toHaveLength(4); // p-print, p-book, 2 shirt variants
    expect(newOps.filter((o) => o.type === 'discount.upsert')).toHaveLength(1);
  });

  it('still rejects files that are neither v1 nor v2', async () => {
    await expect(importBackup('{"foo":1}')).rejects.toThrow('Not a ZollTool backup file');
    await expect(importBackup('not json')).rejects.toThrow('Not a valid JSON file');
  });
});

describe('transactions + op outbox', () => {
  it('recordTransaction writes the tx and an unsynced tx.create op', async () => {
    const tx: Transaction = {
      id: uuidv7(),
      eventId,
      deviceId: 'test-device',
      timestamp: Date.now(),
      method: 'card',
      payments: [{ kind: 'card', amount: 25, provider: 'manual' }],
      items: [{ pid: 'p-print', vid: null, title: 'Art Print A3', qty: 1, unitPrice: 25, lineTotal: 25 }],
      discounts: [],
      total: 25,
      currency: 'CHF',
    };
    await recordTransaction(tx);
    expect(await db.transactions.get(tx.id)).toBeTruthy();
    const ops = await db.ops.where('synced').equals(0).toArray();
    const createOp = ops.find((o) => o.type === 'tx.create' && (o.payload as Transaction).id === tx.id);
    expect(createOp).toBeTruthy();
    expect(createOp!.deviceId).toBe('test-device');
  });

  it('revertTransaction marks the tx and appends a tx.revert op; double revert is a no-op', async () => {
    await revertTransaction('tx-1');
    const tx = await db.transactions.get('tx-1');
    expect(tx!.revertedBy).toBeTruthy();
    const opsBefore = (await db.ops.toArray()).filter((o) => o.type === 'tx.revert').length;
    await revertTransaction('tx-1');
    const opsAfter = (await db.ops.toArray()).filter((o) => o.type === 'tx.revert').length;
    expect(opsAfter).toBe(opsBefore);
  });
});
