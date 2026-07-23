import type {
  DiscountRule,
  EventStock,
  Product,
  SalesEvent,
  ServerOp,
  Transaction,
} from '@zolltool/shared';
import { db } from '@/db/schema';
import { base64ToBlob } from '@/lib/images';

/**
 * Apply ops pulled from the server to the local Dexie database.
 * Rules (deliberately boring):
 *  - transactions are immutable → insert-if-absent; reverts set the marker once
 *  - mutable records (event/product/discount/stock) → last-writer-wins by payload.updatedAt
 *  - ops from this device are skipped (they were applied locally when created)
 * Returns image ids whose full-size version should be fetched lazily.
 */
export async function applyRemoteOps(ops: ServerOp[], ownDeviceId: string): Promise<string[]> {
  const wantFullImages: string[] = [];

  await db.transaction(
    'rw',
    [db.events, db.products, db.eventStock, db.transactions, db.discounts, db.images, db.settings],
    async () => {
      for (const op of ops) {
        if (op.deviceId === ownDeviceId) continue;
        switch (op.type) {
          case 'tx.create': {
            const tx = op.payload as Transaction;
            if (!(await db.transactions.get(tx.id))) await db.transactions.add(tx);
            break;
          }
          case 'tx.revert': {
            const { txId, revertedAt } = op.payload as { txId: string; revertedAt: number };
            const tx = await db.transactions.get(txId);
            if (tx && !tx.revertedBy) {
              await db.transactions.put({ ...tx, revertedBy: op.opId, revertedAt });
            }
            break;
          }
          case 'event.upsert': {
            const event = op.payload as SalesEvent;
            const existing = await db.events.get(event.id);
            if (!existing || event.updatedAt >= existing.updatedAt) await db.events.put(event);
            break;
          }
          case 'event.close': {
            const { eventId, updatedAt } = op.payload as { eventId: string; updatedAt: number };
            const event = await db.events.get(eventId);
            if (event && updatedAt >= event.updatedAt) {
              await db.events.put({ ...event, status: 'closed', updatedAt });
            }
            break;
          }
          case 'product.upsert': {
            const product = op.payload as Product;
            const existing = await db.products.get(product.id);
            if (!existing || product.updatedAt >= existing.updatedAt) await db.products.put(product);
            break;
          }
          case 'product.delete': {
            const { productId, updatedAt } = op.payload as { productId: string; updatedAt: number };
            const product = await db.products.get(productId);
            if (product && updatedAt >= product.updatedAt) {
              await db.products.put({ ...product, deletedAt: updatedAt, updatedAt });
            }
            break;
          }
          case 'stock.set': {
            const row = op.payload as EventStock;
            const existing = await db.eventStock.get([row.eventId, row.productId, row.variantId]);
            if (!existing || row.updatedAt >= existing.updatedAt) await db.eventStock.put(row);
            break;
          }
          case 'discount.upsert': {
            const rule = op.payload as DiscountRule;
            const existing = await db.discounts.get(rule.id);
            if (!existing || rule.updatedAt >= existing.updatedAt) await db.discounts.put(rule);
            break;
          }
          case 'discount.delete': {
            const { ruleId, updatedAt } = op.payload as { ruleId: string; updatedAt: number };
            const rule = await db.discounts.get(ruleId);
            if (rule && updatedAt >= rule.updatedAt) {
              await db.discounts.put({ ...rule, deletedAt: updatedAt, updatedAt });
            }
            break;
          }
          case 'image.meta': {
            const meta = op.payload as { imageId: string; productId: string; updatedAt: number; thumbB64: string };
            if (!(await db.images.get(meta.imageId))) {
              const thumb = base64ToBlob(meta.thumbB64, 'image/webp');
              // Thumb doubles as full until the real full-size arrives from the server.
              await db.images.put({
                id: meta.imageId,
                productId: meta.productId,
                full: thumb,
                thumb,
                updatedAt: meta.updatedAt,
              });
              wantFullImages.push(meta.imageId);
            }
            break;
          }
          case 'setting.upsert': {
            const { key, value, updatedAt } = op.payload as { key: string; value: unknown; updatedAt: number };
            const existing = await db.settings.get(key);
            if (!existing || updatedAt >= (existing.updatedAt ?? 0)) {
              await db.settings.put({ key, value, updatedAt });
            }
            break;
          }
        }
      }
    },
  );

  return wantFullImages;
}
