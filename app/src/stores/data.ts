import { computed } from 'vue';
import { defineStore } from 'pinia';
import type { Product, SalesEvent } from '@zolltool/shared';
import { db } from '@/db/schema';
import { useLive } from '@/db/live';
import { toLocalPrice } from '@/lib/money';
import { useSettingsStore } from './settings';

export interface SoldCounts {
  qty: number;
  value: number;
}

/** Cart/stock key: pid for plain products, `pid:vid` for variants. */
export function stockKey(pid: string, vid: string | null): string {
  return vid ? `${pid}:${vid}` : pid;
}

export const useDataStore = defineStore('data', () => {
  const settings = useSettingsStore();

  // Whole-table live views; data volumes are small (hundreds of products,
  // low thousands of transactions), so filtering happens in computeds.
  const events = useLive<SalesEvent[]>(
    () => db.events.filter((e) => !e.deletedAt).toArray(),
    [],
  );
  const products = useLive<Product[]>(
    () => db.products.filter((p) => !p.deletedAt).sortBy('sortOrder'),
    [],
  );
  const discounts = useLive(
    () => db.discounts.filter((d) => !d.deletedAt).toArray(),
    [],
  );
  const costBatches = useLive(
    () => db.costBatches.filter((b) => !b.deletedAt).toArray(),
    [],
  );
  const allStock = useLive(() => db.eventStock.toArray(), []);
  const allTransactions = useLive(() => db.transactions.toArray(), []);

  const activeEvent = computed<SalesEvent | null>(
    () => events.value.find((e) => e.id === settings.activeEventId) ?? null,
  );

  const currency = computed(() => activeEvent.value?.currency ?? settings.defaultCurrency);

  const localCurrency = computed(() => activeEvent.value?.localCurrency || null);
  const exchangeRate = computed(() => activeEvent.value?.exchangeRate || 1);
  const roundingIncrement = computed(() => activeEvent.value?.roundingIncrement ?? 0);
  const hasLocalCurrency = computed(() => !!localCurrency.value && exchangeRate.value > 0);
  const localPriceOverrides = computed(() => activeEvent.value?.localPriceOverrides ?? {});

  /** Local charge price for a catalog line: manual override if set, else rate-converted + rounded. */
  function localPriceFor(pid: string, vid: string | null, basePrice: number): number {
    const override = localPriceOverrides.value[stockKey(pid, vid)];
    if (override != null) return override;
    return toLocalPrice(basePrice, exchangeRate.value, roundingIncrement.value);
  }

  const localTierOverrides = computed(() => activeEvent.value?.localTierOverrides ?? {});

  /**
   * Local bundle total for a discount rule's currency amount — a tiered
   * tier's total (tierIndex = its index) or a combo rule's flat discount
   * (tierIndex = 'combo'): manual override if set, else rate-converted + rounded.
   */
  function localTierTotal(ruleId: string, tierIndex: number | string, baseTotal: number): number {
    const override = localTierOverrides.value[`${ruleId}:${tierIndex}`];
    if (override != null) return override;
    return toLocalPrice(baseTotal, exchangeRate.value, roundingIncrement.value);
  }

  const eventTransactions = computed(() =>
    allTransactions.value
      .filter((t) => t.eventId === settings.activeEventId)
      .sort((a, b) => b.timestamp - a.timestamp),
  );

  /** broughtQty per stockKey for the active event. */
  const stockByKey = computed<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const row of allStock.value) {
      if (row.eventId !== settings.activeEventId) continue;
      map.set(stockKey(row.productId, row.variantId || null), row.broughtQty);
    }
    return map;
  });

  /** Sold qty/value per stockKey, derived from non-reverted transactions. */
  const soldByKey = computed<Map<string, SoldCounts>>(() => {
    const map = new Map<string, SoldCounts>();
    for (const tx of eventTransactions.value) {
      if (tx.revertedBy) continue;
      for (const item of tx.items) {
        const key = stockKey(item.pid, item.vid);
        const cur = map.get(key) ?? { qty: 0, value: 0 };
        cur.qty += item.qty;
        // Base/tracking currency, even for sales charged in a converted local currency.
        cur.value += item.baseLineTotal ?? item.lineTotal;
        map.set(key, cur);
      }
    }
    return map;
  });

  function broughtQty(pid: string, vid: string | null): number {
    return stockByKey.value.get(stockKey(pid, vid)) ?? 0;
  }

  function soldQty(pid: string, vid: string | null): number {
    return soldByKey.value.get(stockKey(pid, vid))?.qty ?? 0;
  }

  /** Per-unit production cost (base currency): variant cost, else product cost. */
  function costOf(pid: string, vid: string | null): number {
    const p = products.value.find((x) => x.id === pid);
    if (!p) return 0;
    if (vid) return p.variants.find((x) => x.id === vid)?.cost ?? p.cost ?? 0;
    return p.cost ?? 0;
  }

  /** Stock left ignoring the cart (the cart store subtracts its own reservations). */
  function stockLeft(product: Product, vid: string | null): number {
    if (vid) return broughtQty(product.id, vid) - soldQty(product.id, vid);
    if (product.variants.length) {
      return product.variants.reduce((s, v) => s + stockLeft(product, v.id), 0);
    }
    return broughtQty(product.id, null) - soldQty(product.id, null);
  }

  return {
    events,
    products,
    discounts,
    costBatches,
    allStock,
    allTransactions,
    activeEvent,
    currency,
    localCurrency,
    exchangeRate,
    roundingIncrement,
    hasLocalCurrency,
    localPriceOverrides,
    localPriceFor,
    localTierOverrides,
    localTierTotal,
    eventTransactions,
    stockByKey,
    soldByKey,
    broughtQty,
    soldQty,
    costOf,
    stockLeft,
  };
});
