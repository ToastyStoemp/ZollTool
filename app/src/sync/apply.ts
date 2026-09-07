import {
  remapTxItems,
  resolveMergedRef,
  type DiscountRule,
  type EventStock,
  type MergeTarget,
  type Product,
  type ProductMerge,
  type SalesEvent,
  type ServerOp,
  type Transaction,
} from '@zolltool/shared';
import { db } from '@/db/schema';
import { base64ToBlob } from '@/lib/images';
import { loadMergeMap, materializeMerge } from './merge-local';

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
    [db.events, db.products, db.eventStock, db.transactions, db.discounts, db.images, db.settings, db.productMerges, db.costBatches],
    async () => {
      // Resolve historical keys through any merges already materialized locally;
      // kept fresh as product.merge ops are applied below (order-independent).
      let mergeMap: Map<string, MergeTarget> = await loadMergeMap();
      for (const op of ops) {
        if (op.deviceId === ownDeviceId) continue;
        switch (op.type) {
          case 'tx.create': {
            const tx = op.payload as Transaction;
            if (!(await db.transactions.get(tx.id))) {
              const items = remapTxItems(tx.items, mergeMap);
              await db.transactions.add(items === tx.items ? tx : { ...tx, items });
            }
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
          case 'product.merge': {
            const merge = op.payload as ProductMerge;
            const existing = await db.productMerges.get(merge.id);
            if (!existing || merge.updatedAt >= existing.updatedAt) {
              await db.productMerges.put(merge);
              await materializeMerge(merge);
              mergeMap = await loadMergeMap();
            }
            break;
          }
          case 'stock.set': {
            const row = op.payload as EventStock;
            // Fold onto the merged variant if this row's line was merged away.
            const t = resolveMergedRef(mergeMap, row.productId, row.variantId || null);
            const target: EventStock = t
              ? { ...row, productId: t.pid, variantId: t.vid || '' }
              : row;
            const existing = await db.eventStock.get([target.eventId, target.productId, target.variantId]);
            if (!existing || target.updatedAt >= existing.updatedAt) await db.eventStock.put(target);
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
