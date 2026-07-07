/**
 * Builds the v1-shaped CustomsState the (golden-tested) generators expect
 * from live v2 data: event + products + per-event stock + transactions.
 * Brought quantities come from EventStock; sold quantities/values are derived
 * from non-reverted transactions — never stored.
 */
import type { EventStock, Product, SalesEvent, Transaction } from '@zolltool/shared';
import type { CustomsArtist, CustomsEdec, CustomsForm1174, CustomsMeta, CustomsProduct, CustomsState } from './model';
import { defaultCustomsArtist, defaultCustomsEdec, defaultCustomsForm1174, defaultCustomsMeta } from './model';

export interface CustomsBlob {
  meta?: Partial<CustomsMeta>;
  artist?: Partial<CustomsArtist>;
  edec?: Partial<CustomsEdec>;
  form1174?: Partial<CustomsForm1174>;
}

export function readCustomsBlob(event: SalesEvent): CustomsBlob {
  return (event.customs ?? {}) as CustomsBlob;
}

export function buildCustomsState(
  event: SalesEvent,
  products: Product[],
  stock: EventStock[],
  transactions: Transaction[],
): CustomsState {
  const blob = readCustomsBlob(event);

  // Brought quantities: key "productId:variantId" ('' for the product itself)
  const broughtByKey = new Map<string, number>();
  for (const row of stock) {
    if (row.eventId !== event.id) continue;
    broughtByKey.set(`${row.productId}:${row.variantId}`, row.broughtQty);
  }

  // Sold qty/value derived from non-reverted transactions of this event
  const soldByKey = new Map<string, { qty: number; value: number }>();
  for (const tx of transactions) {
    if (tx.eventId !== event.id || tx.revertedBy) continue;
    for (const item of tx.items) {
      const key = `${item.pid}:${item.vid ?? ''}`;
      const cur = soldByKey.get(key) ?? { qty: 0, value: 0 };
      cur.qty += item.qty;
      cur.value += item.lineTotal;
      soldByKey.set(key, cur);
    }
  }

  const customsProducts: CustomsProduct[] = products
    .filter((p) => !p.deletedAt)
    .map((p) => {
      const plainSold = soldByKey.get(`${p.id}:`) ?? { qty: 0, value: 0 };
      return {
        id: p.id,
        title: p.title,
        sku: p.sku,
        type: p.type,
        forSale: p.forSale,
        unlisted: p.unlisted,
        price: p.price,
        priceNote: p.priceNote,
        weightG: p.weightG,
        tariffNo: p.tariffNo,
        tariffRate: p.tariffRate,
        vatRate: p.vatRate,
        packagingType: p.packagingType,
        originCountry: p.originCountry,
        permitOverride: p.permitOverride,
        amount: broughtByKey.get(`${p.id}:`) ?? 0,
        soldQty: plainSold.qty,
        soldValue: plainSold.value,
        variants: p.variants.map((v) => {
          const sold = soldByKey.get(`${p.id}:${v.id}`) ?? { qty: 0, value: 0 };
          return {
            name: v.name,
            sku: v.sku,
            price: v.price ?? null,
            weightG: v.weightG ?? null,
            unlisted: v.unlisted,
            amount: broughtByKey.get(`${p.id}:${v.id}`) ?? 0,
            soldQty: sold.qty,
            soldValue: sold.value,
          };
        }),
      };
    });

  const bm = blob.meta ?? {};
  const meta: CustomsMeta = {
    ...defaultCustomsMeta(),
    ...bm,
    // The event record is the source of truth for everything it owns
    event: event.name,
    eventDateStart: event.dateStart || bm.eventDateStart || '',
    eventDateEnd: event.dateEnd || bm.eventDateEnd || '',
    eventLocation: bm.eventLocation || event.venue.city || '',
    venueStreet: event.venue.street || bm.venueStreet || '',
    venuePostcode: event.venue.postcode || bm.venuePostcode || '',
    venueCity: event.venue.city || bm.venueCity || '',
    venueCountry: event.venue.country || bm.venueCountry || 'Switzerland',
    venueTIN: event.venue.tin || bm.venueTIN || defaultCustomsMeta().venueTIN,
    currency: event.currency,
  };

  const form1174 = { ...defaultCustomsForm1174(), ...(blob.form1174 ?? {}) };
  if (!Array.isArray(form1174.assignments)) form1174.assignments = [];

  return {
    meta,
    artist: { ...defaultCustomsArtist(), ...(blob.artist ?? {}) },
    edec: { ...defaultCustomsEdec(), ...(blob.edec ?? {}) },
    form1174: form1174 as CustomsForm1174,
    products: customsProducts,
  };
}
