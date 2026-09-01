import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { DiscountRule, Product, SalesEvent, Transaction, Variant } from '@zolltool/shared';
import type { JwtClaims } from '../auth';
import { reduceDiscounts, reduceEvents, reduceProducts, reduceTransactions, type ReducibleOp } from '../reduce';
import { storeFullImage } from './images';
import type { Rooms } from '../ws';

/**
 * Data API — exposes an account's catalog, events and transactions, materialized
 * from the op-log (see reduce.ts). Reads back external tooling such as the
 * accounting bridge and ZollPriceCards; the write half (PATCH/image) backs the
 * Shopify sync tool, which pushes SKUs, prices and artwork back into ZollTool.
 * Reads need a `data:read` token (or JWT); writes need `data:write` (or an
 * owner/admin JWT). Every route is scoped to the caller's own account.
 */

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
// Synthetic device id stamped on ops the write API appends, so they are
// attributable in the log and excluded from no other device's nudge.
const EXT_DEVICE_ID = 'ext:api';

interface OpRow {
  type: string;
  payload: string;
  opId: string;
}

/** Load the account's ops of the given types, seq-ordered, with payloads parsed. */
function loadOps(db: Database.Database, accountId: string, types: string[]): ReducibleOp[] {
  const placeholders = types.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT type, payload, opId FROM ops WHERE accountId = ? AND type IN (${placeholders}) ORDER BY seq ASC`)
    .all(accountId, ...types) as OpRow[];
  return rows.map((r) => ({ type: r.type, opId: r.opId, payload: JSON.parse(r.payload) as unknown }));
}

/** Current (non-deleted) product by id for an account, or undefined. */
function loadProduct(db: Database.Database, accountId: string, id: string): Product | undefined {
  const ops = loadOps(db, accountId, ['product.upsert', 'product.delete']);
  const p = reduceProducts(ops).find((x) => x.id === id);
  return p && !p.deletedAt ? p : undefined;
}

const dayStart = (d: string): number => Date.parse(/T/.test(d) ? d : `${d}T00:00:00`);
const dayEnd = (d: string): number => Date.parse(/T/.test(d) ? d : `${d}T23:59:59.999`);

export function registerDataRoutes(
  app: FastifyInstance,
  db: Database.Database,
  rooms: Rooms,
  dataDir: string,
): void {
  const nextSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM ops WHERE accountId = ?');
  const insertOp = db.prepare(
    `INSERT INTO ops (accountId, seq, opId, deviceId, ts, type, payload, receivedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  /**
   * Append catalog ops to the account's log in one transaction and wake live
   * devices. Mirrors the seq/insert/nudge machinery of the sync push route.
   */
  function appendOps(accountId: string, ops: { type: string; payload: unknown }[]): number {
    const latest = db.transaction((): number => {
      let seq = (nextSeq.get(accountId) as { m: number }).m;
      const now = Date.now();
      for (const op of ops) {
        seq++;
        insertOp.run(accountId, seq, randomUUID(), EXT_DEVICE_ID, now, op.type, JSON.stringify(op.payload ?? null), now);
      }
      return seq;
    })();
    rooms.nudge(accountId, latest, EXT_DEVICE_ID);
    return latest;
  }

  // Current (non-deleted) events for the account.
  app.get('/api/data/events', { preHandler: app.authenticateApiOrJwt }, async (req): Promise<SalesEvent[]> => {
    const claims = req.user as JwtClaims;
    const ops = loadOps(db, claims.accountId, ['event.upsert', 'event.close']);
    return reduceEvents(ops).filter((e) => !e.deletedAt);
  });

  // Current (non-deleted) catalog products for the account — backs external
  // tooling like ZollPriceCards that renders price signage from the catalog.
  app.get('/api/data/products', { preHandler: app.authenticateApiOrJwt }, async (req): Promise<Product[]> => {
    const claims = req.user as JwtClaims;
    const ops = loadOps(db, claims.accountId, ['product.upsert', 'product.delete']);
    return reduceProducts(ops).filter((p) => !p.deletedAt);
  });

  // Current (non-deleted) discount rules — lets tooling (ZollPriceCards) render
  // tiered "N for €X" bundle prices onto cards.
  app.get('/api/data/discounts', { preHandler: app.authenticateApiOrJwt }, async (req): Promise<DiscountRule[]> => {
    const claims = req.user as JwtClaims;
    const ops = loadOps(db, claims.accountId, ['discount.upsert', 'discount.delete']);
    return reduceDiscounts(ops).filter((d) => !d.deletedAt);
  });

  // Transactions belonging to one event.
  app.get(
    '/api/data/events/:eventId/transactions',
    { preHandler: app.authenticateApiOrJwt },
    async (req): Promise<Transaction[]> => {
      const claims = req.user as JwtClaims;
      const { eventId } = req.params as { eventId: string };
      const ops = loadOps(db, claims.accountId, ['tx.create', 'tx.revert']);
      return reduceTransactions(ops).filter((t) => t.eventId === eventId);
    },
  );

  // Transactions across all events, optionally windowed by timestamp.
  app.get('/api/data/transactions', { preHandler: app.authenticateApiOrJwt }, async (req): Promise<Transaction[]> => {
    const claims = req.user as JwtClaims;
    const { from, to } = req.query as { from?: string; to?: string };
    const fromTs = from ? dayStart(from) : -Infinity;
    const toTs = to ? dayEnd(to) : Infinity;
    const ops = loadOps(db, claims.accountId, ['tx.create', 'tx.revert']);
    return reduceTransactions(ops).filter((t) => t.timestamp >= fromTs && t.timestamp <= toTs);
  });

  // ── Write API (data:write) — external tooling pushes catalog edits back in ──

  // Scalar product fields the write API may overwrite. `variants` is merged
  // separately (by id); everything else on the product is preserved as-is.
  const SCALAR_FIELDS = [
    'title', 'sku', 'type', 'forSale', 'unlisted', 'price', 'priceNote', 'weightG',
    'tariffNo', 'tariffRate', 'vatRate', 'packagingType', 'originCountry',
    'permitOverride', 'year', 'imageId',
  ] as const;

  /** Merge an incoming partial onto a product; returns a new product to upsert. */
  function mergeProduct(current: Product, patch: Record<string, unknown>): Product {
    const next: Product = { ...current };
    for (const f of SCALAR_FIELDS) {
      if (patch[f] !== undefined) (next as unknown as Record<string, unknown>)[f] = patch[f];
    }
    if (Array.isArray(patch.variants)) {
      const byId = new Map(current.variants.map((v) => [v.id, v]));
      for (const raw of patch.variants as Partial<Variant>[]) {
        if (!raw || typeof raw.id !== 'string') continue;
        const existing = byId.get(raw.id);
        // Update-in-place only: unknown variant ids are ignored so the sync tool
        // can never silently spawn variants that don't exist in ZollTool.
        if (existing) byId.set(raw.id, { ...existing, ...raw, id: raw.id });
      }
      next.variants = current.variants.map((v) => byId.get(v.id) ?? v);
    }
    next.updatedAt = Date.now();
    return next;
  }

  // Patch selected fields of one product (SKU, price, weight, title, imageId,
  // and per-variant SKUs). Emits a product.upsert op (last-writer-wins).
  app.patch('/api/data/products/:id', { preHandler: app.authenticateApiWrite }, async (req, reply) => {
    const claims = req.user as JwtClaims;
    const { id } = req.params as { id: string };
    const current = loadProduct(db, claims.accountId, id);
    if (!current) return reply.code(404).send({ error: 'Product not found' });
    const patch = (req.body ?? {}) as Record<string, unknown>;
    const next = mergeProduct(current, patch);
    appendOps(claims.accountId, [{ type: 'product.upsert', payload: next }]);
    return next;
  });

  // Attach an image to a product (or one of its variants) — the "pick a Shopify
  // image" flow. The caller sends the full-size bytes plus a small webp thumb
  // (base64); the thumb rides inline in the image.meta op so offline POS devices
  // can render it, and the full is stored on disk. Links via product.upsert.
  app.post('/api/data/products/:id/image', { preHandler: app.authenticateApiWrite }, async (req, reply) => {
    const claims = req.user as JwtClaims;
    const { id } = req.params as { id: string };
    const current = loadProduct(db, claims.accountId, id);
    if (!current) return reply.code(404).send({ error: 'Product not found' });

    const body = (req.body ?? {}) as { full?: string; thumb?: string; mime?: string; variantId?: string };
    if (typeof body.full !== 'string' || typeof body.thumb !== 'string') {
      return reply.code(400).send({ error: 'full and thumb (base64) are required' });
    }
    const full = Buffer.from(body.full, 'base64');
    if (full.length === 0) return reply.code(400).send({ error: 'Empty image' });
    if (full.length > MAX_IMAGE_BYTES) return reply.code(413).send({ error: 'Image too large' });
    if (body.variantId && !current.variants.some((v) => v.id === body.variantId)) {
      return reply.code(404).send({ error: 'Variant not found' });
    }

    const imageId = randomUUID();
    const now = Date.now();
    await storeFullImage(db, dataDir, claims.accountId, imageId, full, body.mime || 'image/jpeg');

    // Point the product (or the named variant) at the new image.
    const next: Product = { ...current, updatedAt: now };
    if (body.variantId) {
      next.variants = current.variants.map((v) => (v.id === body.variantId ? { ...v, imageId } : v));
    } else {
      next.imageId = imageId;
    }
    appendOps(claims.accountId, [
      { type: 'image.meta', payload: { imageId, productId: id, updatedAt: now, thumbB64: body.thumb } },
      { type: 'product.upsert', payload: next },
    ]);
    return { imageId, product: next };
  });
}
