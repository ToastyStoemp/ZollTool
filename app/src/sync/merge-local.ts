import {
  buildMergeMap,
  mergeKey,
  remapTxItems,
  resolveMergedRef,
  type MergeTarget,
  type ProductMerge,
} from '@zolltool/shared';
import { db } from '@/db/schema';

/**
 * Materialize a product merge onto the local Dexie tables: rewrite historical
 * sale lines, re-key event stock, and repoint discounts / price overrides /
 * cost batches at the merged product's variants.
 *
 * The `product.merge` op is the source of truth; every device runs this to
 * derive the same materialized state. It is naturally idempotent — once a
 * source key has been remapped it no longer matches, so a second run is a no-op.
 *
 * Must be called from inside a Dexie `rw` transaction that already scopes
 * transactions, eventStock, discounts, events and costBatches.
 */
export async function materializeMerge(merge: ProductMerge): Promise<void> {
  const map = buildMergeMap([merge]);
  if (!map.size) return;

  // Historical sale lines → merged product/variant (+ frozen title/label).
  const txs = await db.transactions.toArray();
  for (const tx of txs) {
    const items = remapTxItems(tx.items, map);
    if (items !== tx.items) await db.transactions.put({ ...tx, items });
  }

  // Event stock: re-key each row; fold into an existing target row if present.
  const stock = await db.eventStock.toArray();
  for (const row of stock) {
    const t = resolveMergedRef(map, row.productId, row.variantId || null);
    if (!t) continue;
    const targetVid = t.vid || '';
    await db.eventStock.delete([row.eventId, row.productId, row.variantId]);
    const key: [string, string, string] = [row.eventId, t.pid, targetVid];
    const existing = await db.eventStock.get(key);
    await db.eventStock.put({
      eventId: row.eventId,
      productId: t.pid,
      variantId: targetVid,
      broughtQty: (existing?.broughtQty ?? 0) + row.broughtQty,
      updatedAt: Date.now(),
    });
  }

  // Discount rules: repoint product / variant references.
  const rules = await db.discounts.toArray();
  for (const rule of rules) {
    let changed = false;
    const productIds = (rule.productIds ?? []).map((pid) => {
      const t = resolveMergedRef(map, pid, null);
      if (!t) return pid;
      changed = true;
      // A whole-product reference becomes a variant reference under the merged product.
      return null;
    });
    const variantIds = new Set(rule.variantIds ?? []);
    if (changed) {
      // Add the merged variant refs for every source product the rule covered.
      for (const pid of rule.productIds ?? []) {
        const t = resolveMergedRef(map, pid, null);
        if (t) variantIds.add(mergeKey(t.pid, t.vid));
      }
    }
    // Existing "pid:vid" variant refs that were merged.
    for (const vref of rule.variantIds ?? []) {
      const [pid, vid] = vref.split(':');
      const t = resolveMergedRef(map, pid, vid ?? null);
      if (t) {
        changed = true;
        variantIds.delete(vref);
        variantIds.add(mergeKey(t.pid, t.vid));
      }
    }
    if (changed) {
      await db.discounts.put({
        ...rule,
        productIds: productIds.filter((p): p is string => p !== null),
        variantIds: [...variantIds],
        updatedAt: Date.now(),
      });
    }
  }

  // Event local-price overrides: re-key by stockKey.
  const events = await db.events.toArray();
  for (const event of events) {
    if (!event.localPriceOverrides) continue;
    let changed = false;
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(event.localPriceOverrides)) {
      const [pid, vid] = k.split(':');
      const t = resolveMergedRef(map, pid, vid ?? null);
      if (t) {
        changed = true;
        next[mergeKey(t.pid, t.vid)] = v;
      } else {
        next[k] = v;
      }
    }
    if (changed) await db.events.put({ ...event, localPriceOverrides: next, updatedAt: Date.now() });
  }

  // Cost batches (local-only): repoint their lines so cost history stays attached.
  const batches = await db.costBatches.toArray();
  for (const batch of batches) {
    let changed = false;
    const lines = batch.lines.map((line) => {
      const t = resolveMergedRef(map, line.pid, line.vid || null);
      if (!t) return line;
      changed = true;
      return { ...line, pid: t.pid, vid: t.vid || '' };
    });
    if (changed) await db.costBatches.put({ ...batch, lines, updatedAt: Date.now() });
  }
}

/** Load the current merge map from the local materialized merges. */
export async function loadMergeMap(): Promise<Map<string, MergeTarget>> {
  return buildMergeMap(await db.productMerges.toArray());
}
