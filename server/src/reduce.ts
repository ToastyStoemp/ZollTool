import type { DiscountRule, Product, SalesEvent, Transaction } from '@zolltool/shared';

/**
 * Materialize current entities from the op-log. The server stores only ops
 * (opaque payloads); these reducers replay the relevant ops in `seq` order using
 * the same rules as the app's `app/src/sync/apply.ts`, so a read API can hand
 * out events/transactions without the app pushing anything new.
 */

export interface ReducibleOp {
  type: string;
  /** The revert op's own id — becomes `revertedBy` on the cancelled transaction. */
  opId: string;
  /** Parsed op payload (a full SalesEvent / Transaction, or a small delta). */
  payload: unknown;
}

/** Events by id: event.upsert (last-writer-wins by updatedAt) + event.close. */
export function reduceEvents(ops: ReducibleOp[]): SalesEvent[] {
  const byId = new Map<string, SalesEvent>();
  for (const op of ops) {
    if (op.type === 'event.upsert') {
      const e = op.payload as SalesEvent;
      const existing = byId.get(e.id);
      if (!existing || e.updatedAt >= existing.updatedAt) byId.set(e.id, e);
    } else if (op.type === 'event.close') {
      const { eventId, updatedAt } = op.payload as { eventId: string; updatedAt: number };
      const e = byId.get(eventId);
      if (e && updatedAt >= e.updatedAt) byId.set(eventId, { ...e, status: 'closed', updatedAt });
    }
  }
  return [...byId.values()];
}

/** Products by id: product.upsert (last-writer-wins by updatedAt) + product.delete. */
export function reduceProducts(ops: ReducibleOp[]): Product[] {
  const byId = new Map<string, Product>();
  for (const op of ops) {
    if (op.type === 'product.upsert') {
      const p = op.payload as Product;
      const existing = byId.get(p.id);
      if (!existing || p.updatedAt >= existing.updatedAt) byId.set(p.id, p);
    } else if (op.type === 'product.delete') {
      const { productId, updatedAt } = op.payload as { productId: string; updatedAt: number };
      const p = byId.get(productId);
      if (p && updatedAt >= p.updatedAt) byId.set(productId, { ...p, deletedAt: updatedAt, updatedAt });
    }
  }
  return [...byId.values()];
}

/** Discount rules by id: discount.upsert (LWW by updatedAt) + discount.delete. */
export function reduceDiscounts(ops: ReducibleOp[]): DiscountRule[] {
  const byId = new Map<string, DiscountRule>();
  for (const op of ops) {
    if (op.type === 'discount.upsert') {
      const r = op.payload as DiscountRule;
      const existing = byId.get(r.id);
      if (!existing || r.updatedAt >= existing.updatedAt) byId.set(r.id, r);
    } else if (op.type === 'discount.delete') {
      const { ruleId, updatedAt } = op.payload as { ruleId: string; updatedAt: number };
      const r = byId.get(ruleId);
      if (r && updatedAt >= r.updatedAt) byId.set(ruleId, { ...r, deletedAt: updatedAt, updatedAt });
    }
  }
  return [...byId.values()];
}

/** Transactions by id: tx.create (insert-if-absent) + tx.revert (set marker once). */
export function reduceTransactions(ops: ReducibleOp[]): Transaction[] {
  const byId = new Map<string, Transaction>();
  for (const op of ops) {
    if (op.type === 'tx.create') {
      const tx = op.payload as Transaction;
      if (!byId.has(tx.id)) byId.set(tx.id, tx);
    } else if (op.type === 'tx.revert') {
      const { txId, revertedAt } = op.payload as { txId: string; revertedAt: number };
      const tx = byId.get(txId);
      if (tx && !tx.revertedBy) byId.set(txId, { ...tx, revertedBy: op.opId, revertedAt });
    }
  }
  return [...byId.values()];
}
