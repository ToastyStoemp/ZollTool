import type {
  DiscountRule,
  EventStock,
  Product,
  SalesEvent,
  Transaction,
  Variant,
} from '@zolltool/shared';
import type { OpType } from '@zolltool/shared';
import { db } from './schema';
import { appendOps, setSetting } from './repo';
import { uuidv7 } from '@/lib/uuid';

const V1_KEY = 'zolltool_state_v1';

/** Loose shape of the v1 state blob — everything is optional/untyped in practice. */
interface V1State {
  meta?: Record<string, any>;
  artist?: Record<string, any>;
  edec?: Record<string, any>;
  form1174?: Record<string, any>;
  products?: any[];
  transactions?: any[];
  discounts?: any[];
}

/** v1 calcProduct(): unit price = totalValueCHF/amount override, else price. */
function v1UnitPrice(p: any): number {
  const amount = p.amount || 0;
  let totalValue: number | null = p.totalValueCHF != null ? Math.round(parseFloat(p.totalValueCHF)) : null;
  if (totalValue == null && p.price != null && p.price !== '') {
    totalValue = Math.round(parseFloat(p.price) * amount);
  }
  if (totalValue != null && amount > 0) return totalValue / amount;
  const direct = parseFloat(p.price);
  return Number.isFinite(direct) ? direct : 0;
}

function num(v: unknown): number | undefined {
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Import a v1 state blob into the v2 database: one event carrying the customs
 * data, global products, per-event stock, transactions and discount rules.
 * Also used by the manual "import legacy JSON" path.
 */
export async function importV1State(state: V1State, deviceId: string): Promise<string> {
  const now = Date.now();
  const meta = state.meta || {};

  const event: SalesEvent = {
    id: uuidv7(),
    name: meta.event || 'Imported event',
    dateStart: meta.eventDateStart || undefined,
    dateEnd: meta.eventDateEnd || undefined,
    venue: {
      street: meta.venueStreet || undefined,
      postcode: meta.venuePostcode || undefined,
      city: meta.venueCity || meta.eventLocation || undefined,
      country: meta.venueCountry || undefined,
      tin: meta.venueTIN || undefined,
    },
    currency: meta.currency || 'CHF',
    status: 'active',
    customs: {
      meta: state.meta,
      artist: state.artist,
      edec: state.edec,
      form1174: state.form1174,
    },
    updatedAt: now,
  };

  const products: Product[] = [];
  const stock: EventStock[] = [];

  (state.products || []).forEach((p: any, index: number) => {
    const variants: Variant[] = (p.variants || []).map((v: any) => ({
      id: v.id || uuidv7(),
      name: v.name || '',
      sku: v.sku || undefined,
      price: num(v.price),
      weightG: num(v.weightG),
      unlisted: !!v.unlisted,
    }));

    products.push({
      id: p.id || uuidv7(),
      title: p.title || '',
      sku: p.sku || undefined,
      type: p.type || undefined,
      forSale: p.forSale !== false,
      unlisted: !!p.unlisted,
      price: v1UnitPrice(p),
      priceNote: p.priceNote || undefined,
      weightG: num(p.weightG),
      tariffNo: p.tariffNo || undefined,
      tariffRate: num(p.tariffRate),
      vatRate: num(p.vatRate),
      packagingType: p.packagingType || undefined,
      originCountry: p.originCountry || undefined,
      variants,
      sortOrder: index,
      updatedAt: now,
    });

    if (variants.length) {
      (p.variants || []).forEach((v: any) => {
        stock.push({
          eventId: event.id,
          productId: p.id,
          variantId: v.id,
          broughtQty: v.amount || 0,
          updatedAt: now,
        });
      });
    } else {
      stock.push({
        eventId: event.id,
        productId: p.id,
        variantId: '',
        broughtQty: p.amount || 0,
        updatedAt: now,
      });
    }
  });

  const transactions: Transaction[] = (state.transactions || []).map((t: any) => ({
    id: t.id || uuidv7(),
    eventId: event.id,
    deviceId,
    timestamp: t.timestamp || now,
    method: t.method || 'cash',
    payments: (t.payments || []).map((leg: any) => ({
      kind: leg.method === 'card' ? 'card' : 'cash',
      amount: leg.amount || 0,
    })),
    items: (t.items || []).map((it: any) => ({
      pid: it.pid,
      vid: it.vid ?? null,
      title: it.title || '',
      variantLabel: it.variantLabel || undefined,
      qty: it.qty || 0,
      unitPrice: it.unitPrice ?? 0,
      lineTotal: it.lineTotal ?? 0,
    })),
    discounts: (t.discounts || []).map((d: any) => ({
      id: d.id || undefined,
      name: d.name || 'Discount',
      amount: d.amount || 0,
      custom: !!d.custom,
    })),
    total: t.total || 0,
    currency: t.currency || event.currency,
    revertedBy: t.reverted ? 'v1-import' : undefined,
    revertedAt: t.reverted ? (t.revertedAt || undefined) : undefined,
  }));

  const discounts: DiscountRule[] = (state.discounts || []).map((d: any) => ({
    id: d.id || uuidv7(),
    name: d.name || 'Discount',
    type: d.type === 'nth_pct' || d.type === 'tiered' ? d.type : 'bxgy',
    productIds: Array.isArray(d.productIds) ? d.productIds : [],
    variantIds: Array.isArray(d.variantIds) ? d.variantIds : [],
    buyQty: num(d.buyQty),
    freeQty: num(d.freeQty),
    nth: num(d.nth),
    percent: num(d.percent),
    tiers: Array.isArray(d.tiers) ? d.tiers : undefined,
    tierContinue: !!d.tierContinue,
    updatedAt: now,
  }));

  await db.transaction(
    'rw',
    [db.events, db.products, db.eventStock, db.transactions, db.discounts, db.settings, db.ops],
    async () => {
      await db.events.put(event);
      await db.products.bulkPut(products);
      await db.eventStock.bulkPut(stock);
      await db.transactions.bulkPut(transactions);
      await db.discounts.bulkPut(discounts);
      await db.settings.put({ key: 'activeEventId', value: event.id });
      // Queue everything for sync so the imported data reaches other devices
      await appendOps([
        { type: 'event.upsert' as OpType, payload: event },
        ...products.map((p) => ({ type: 'product.upsert' as OpType, payload: p })),
        ...stock.map((s) => ({ type: 'stock.set' as OpType, payload: s })),
        ...transactions.map((t) => ({ type: 'tx.create' as OpType, payload: t })),
        ...discounts.map((d) => ({ type: 'discount.upsert' as OpType, payload: d })),
      ]);
    },
  );

  return event.id;
}

/**
 * One-time auto-migration: runs when the v2 DB is empty and a v1 blob exists.
 * The v1 localStorage key is left untouched as a rollback backup.
 */
export async function migrateV1IfNeeded(deviceId: string): Promise<boolean> {
  const migrated = await db.settings.get('migratedV1');
  if (migrated) return false;
  const eventCount = await db.events.count();
  if (eventCount > 0) {
    await setSetting('migratedV1', Date.now());
    return false;
  }
  const raw = localStorage.getItem(V1_KEY);
  if (!raw) return false;
  let state: V1State;
  try {
    state = JSON.parse(raw);
  } catch {
    return false;
  }
  await importV1State(state, deviceId);
  await setSetting('migratedV1', Date.now());
  return true;
}
