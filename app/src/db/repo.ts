import type {
  DiscountRule,
  Op,
  OpType,
  Product,
  SalesEvent,
  Transaction,
} from '@zolltool/shared';
import { toRaw } from 'vue';
import { db } from './schema';
import { uuidv7 } from '@/lib/uuid';

/**
 * Repository layer: every mutation applies to its Dexie table AND appends an
 * op to the outbox in the same transaction, so the app is sync-ready even
 * before a server is configured.
 */

/**
 * IndexedDB structured-clones what it stores, and that throws DataCloneError
 * on Vue reactive proxies. Records handed to the repo often come straight out
 * of a Pinia store (e.g. `{ ...event }` keeps the nested `venue` proxy), so
 * unwrap proxies deeply before writing.
 */
function plain<T>(value: T): T {
  const raw = toRaw(value) as T;
  if (Array.isArray(raw)) return raw.map((v) => plain(v)) as T;
  if (raw && typeof raw === 'object' && (raw as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) out[k] = plain(v);
    return out as T;
  }
  return raw;
}

async function getSettingRaw(key: string): Promise<unknown> {
  return (await db.settings.get(key))?.value;
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await getSettingRaw(key)) as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export async function ensureDeviceId(): Promise<string> {
  let id = await getSetting<string>('deviceId');
  if (!id) {
    id = uuidv7();
    await setSetting('deviceId', id);
  }
  return id;
}

export async function appendOp(type: OpType, payload: unknown): Promise<Op> {
  const deviceId = ((await getSettingRaw('deviceId')) as string) || 'unknown-device';
  const op: Op = { opId: uuidv7(), deviceId, ts: Date.now(), type, payload };
  await db.ops.add({ ...op, synced: 0 });
  return op;
}

/** Bulk variant for imports/migrations: one settings lookup, one bulkAdd. */
export async function appendOps(entries: { type: OpType; payload: unknown }[]): Promise<void> {
  if (!entries.length) return;
  const deviceId = ((await getSettingRaw('deviceId')) as string) || 'unknown-device';
  const ts = Date.now();
  await db.ops.bulkAdd(
    entries.map((e) => ({ opId: uuidv7(), deviceId, ts, type: e.type, payload: e.payload, synced: 0 as const })),
  );
}

// ── Events ────────────────────────────────────────────────────────────────

export async function upsertEvent(event: SalesEvent): Promise<void> {
  const record = plain(event);
  await db.transaction('rw', [db.events, db.ops, db.settings], async () => {
    await db.events.put(record);
    await appendOp('event.upsert', record);
  });
}

export async function closeEvent(eventId: string): Promise<void> {
  await db.transaction('rw', [db.events, db.ops, db.settings], async () => {
    const event = await db.events.get(eventId);
    if (!event) return;
    const closed: SalesEvent = { ...event, status: 'closed', updatedAt: Date.now() };
    await db.events.put(closed);
    await appendOp('event.close', { eventId, updatedAt: closed.updatedAt });
  });
}

// ── Products / stock / discounts ──────────────────────────────────────────

export async function upsertProduct(product: Product): Promise<void> {
  const record = plain(product);
  await db.transaction('rw', [db.products, db.ops, db.settings], async () => {
    await db.products.put(record);
    await appendOp('product.upsert', record);
  });
}

export async function deleteProduct(productId: string): Promise<void> {
  await db.transaction('rw', [db.products, db.ops, db.settings], async () => {
    const product = await db.products.get(productId);
    if (!product) return;
    const tombstone: Product = { ...product, deletedAt: Date.now(), updatedAt: Date.now() };
    await db.products.put(tombstone);
    await appendOp('product.delete', { productId, updatedAt: tombstone.updatedAt });
  });
}

export async function setStock(
  eventId: string,
  productId: string,
  variantId: string,
  broughtQty: number,
): Promise<void> {
  await db.transaction('rw', [db.eventStock, db.ops, db.settings], async () => {
    const row = { eventId, productId, variantId, broughtQty, updatedAt: Date.now() };
    await db.eventStock.put(row);
    await appendOp('stock.set', row);
  });
}

export async function upsertDiscount(rule: DiscountRule): Promise<void> {
  const record = plain(rule);
  await db.transaction('rw', [db.discounts, db.ops, db.settings], async () => {
    await db.discounts.put(record);
    await appendOp('discount.upsert', record);
  });
}

export async function deleteDiscount(ruleId: string): Promise<void> {
  await db.transaction('rw', [db.discounts, db.ops, db.settings], async () => {
    const rule = await db.discounts.get(ruleId);
    if (!rule) return;
    const tombstone: DiscountRule = { ...rule, deletedAt: Date.now(), updatedAt: Date.now() };
    await db.discounts.put(tombstone);
    await appendOp('discount.delete', { ruleId, updatedAt: tombstone.updatedAt });
  });
}

// ── Transactions ──────────────────────────────────────────────────────────

export async function recordTransaction(tx: Transaction): Promise<void> {
  const record = plain(tx);
  await db.transaction('rw', [db.transactions, db.ops, db.settings], async () => {
    await db.transactions.add(record);
    await appendOp('tx.create', record);
  });
}

export async function revertTransaction(txId: string): Promise<void> {
  await db.transaction('rw', [db.transactions, db.ops, db.settings], async () => {
    const tx = await db.transactions.get(txId);
    if (!tx || tx.revertedBy) return;
    const op = await appendOp('tx.revert', { txId, revertedAt: Date.now() });
    await db.transactions.put({ ...tx, revertedBy: op.opId, revertedAt: Date.now() });
  });
}
