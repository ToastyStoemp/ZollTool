import type {
  DiscountRule,
  Op,
  OpType,
  Product,
  SalesEvent,
  Transaction,
} from '@zolltool/shared';
import { db } from './schema';
import { uuidv7 } from '@/lib/uuid';

/**
 * Repository layer: every mutation applies to its Dexie table AND appends an
 * op to the outbox in the same transaction, so the app is sync-ready even
 * before a server is configured.
 */

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

// ── Events ────────────────────────────────────────────────────────────────

export async function upsertEvent(event: SalesEvent): Promise<void> {
  await db.transaction('rw', [db.events, db.ops, db.settings], async () => {
    await db.events.put(event);
    await appendOp('event.upsert', event);
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
  await db.transaction('rw', [db.products, db.ops, db.settings], async () => {
    await db.products.put(product);
    await appendOp('product.upsert', product);
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
  await db.transaction('rw', [db.discounts, db.ops, db.settings], async () => {
    await db.discounts.put(rule);
    await appendOp('discount.upsert', rule);
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
  await db.transaction('rw', [db.transactions, db.ops, db.settings], async () => {
    await db.transactions.add(tx);
    await appendOp('tx.create', tx);
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
