import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { PaymentLeg, PaymentMethod, Transaction } from '@zolltool/shared';
import {
  computeCartTotals,
  distributeTotal,
  type CartLine,
  type CustomDiscount,
} from '@/lib/discounts';
import { round2, roundToIncrement } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';
import { recordTransaction } from '@/db/repo';
import { useDataStore, stockKey } from './data';
import { useSettingsStore } from './settings';

function parseCartKey(key: string): { pid: string; vid: string | null } {
  const idx = key.indexOf(':');
  return idx === -1 ? { pid: key, vid: null } : { pid: key.slice(0, idx), vid: key.slice(idx + 1) };
}

export const useCartStore = defineStore('cart', () => {
  const data = useDataStore();
  const settings = useSettingsStore();

  /** stockKey → qty */
  const items = ref<Record<string, number>>({});
  const customDiscount = ref<CustomDiscount | null>(null);
  /**
   * One-off items sold outside the catalog (commissions, old stock, …),
   * keyed "misc:<uuid>". They ride through checkout as normal lines; discount
   * rules never match them and no stock is tracked.
   */
  const miscItems = ref<Record<string, { title: string; price: number; qty: number }>>({});

  const lines = computed<CartLine[]>(() => {
    const result: CartLine[] = [];
    for (const [key, m] of Object.entries(miscItems.value)) {
      if (!m.qty) continue;
      result.push({
        pid: key,
        vid: null,
        title: m.title,
        variantLabel: null,
        qty: m.qty,
        unitPrice: m.price,
        lineTotal: m.price * m.qty,
      });
    }
    for (const [key, qty] of Object.entries(items.value)) {
      if (!qty) continue;
      const { pid, vid } = parseCartKey(key);
      const product = data.products.find((p) => p.id === pid);
      if (!product) continue;
      let unitPrice = product.price;
      let variantLabel: string | null = null;
      if (vid) {
        const variant = product.variants.find((v) => v.id === vid);
        if (!variant) continue;
        unitPrice = variant.price ?? product.price;
        variantLabel = variant.name || vid;
      }
      result.push({
        pid,
        vid,
        title: product.title || '(untitled)',
        variantLabel,
        type: product.type,
        qty,
        unitPrice,
        lineTotal: unitPrice * qty,
      });
    }
    return result;
  });

  const itemCount = computed(
    () =>
      Object.values(items.value).reduce((s, q) => s + q, 0) +
      Object.values(miscItems.value).reduce((s, m) => s + m.qty, 0),
  );

  const totals = computed(() =>
    computeCartTotals(lines.value, data.discounts, customDiscount.value),
  );

  /**
   * Presentation/charge-currency view of the cart. When the active event has
   * a local currency configured, discounts still run entirely in base
   * currency above (thresholds are authored in base currency) — this layer
   * only converts+rounds the already-discounted numbers for display and
   * charging, so it's the single source of truth shared by the on-screen
   * breakdown, the customer-display payload, and checkout.
   */
  const chargeCurrency = computed(() => (data.hasLocalCurrency ? data.localCurrency! : data.currency));
  const chargeRate = computed(() => (data.hasLocalCurrency ? data.exchangeRate : 1));
  const chargeIncrement = computed(() => (data.hasLocalCurrency ? data.roundingIncrement : 0));

  /** Per-line local price: a manual override (Price compare) if set, else rate-converted + rounded. */
  const chargeLines = computed<CartLine[]>(() =>
    lines.value.map((l) => {
      const unitPrice = data.localPriceFor(l.pid, l.vid, l.unitPrice);
      return { ...l, unitPrice, lineTotal: unitPrice * l.qty };
    }),
  );

  /** Sum of the (possibly overridden) line prices — the authoritative basis for what's charged. */
  const chargeSubtotal = computed(() => chargeLines.value.reduce((s, l) => s + l.lineTotal, 0));

  const chargeDiscountTotal = computed(() =>
    round2(
      (totals.value.ruleDiscountTotal + totals.value.customDiscountAmount) * chargeRate.value,
    ),
  );

  /** Final safety-net rounding for any residual cents left after discounts — a no-op when the line prices are already round. */
  const chargeGrandTotal = computed(() =>
    roundToIncrement(chargeSubtotal.value - chargeDiscountTotal.value, chargeIncrement.value),
  );

  /** Delta between (line prices − discounts) and the actually-charged total, shown transparently. */
  const chargeRoundingAdjustment = computed(() =>
    round2(chargeGrandTotal.value - (chargeSubtotal.value - chargeDiscountTotal.value)),
  );

  function inCart(pid: string, vid: string | null): number {
    return items.value[stockKey(pid, vid)] ?? 0;
  }

  /** Stock remaining after subtracting what's already in the cart. */
  function remaining(pid: string, vid: string | null): number {
    const product = data.products.find((p) => p.id === pid);
    if (!product) return 0;
    if (!vid && product.variants.length) {
      return product.variants.reduce((s, v) => s + remaining(pid, v.id), 0);
    }
    return data.stockLeft(product, vid) - inCart(pid, vid);
  }

  function add(pid: string, vid: string | null): void {
    const key = stockKey(pid, vid);
    items.value = { ...items.value, [key]: (items.value[key] ?? 0) + 1 };
  }

  function addMisc(title: string, price: number, qty = 1): void {
    miscItems.value = {
      ...miscItems.value,
      [`misc:${uuidv7()}`]: { title: title.trim() || 'Misc item', price, qty },
    };
  }

  function setQty(key: string, qty: number): void {
    if (key.startsWith('misc:')) {
      const next = { ...miscItems.value };
      if (qty <= 0) delete next[key];
      else if (next[key]) next[key] = { ...next[key], qty };
      miscItems.value = next;
    } else {
      const next = { ...items.value };
      if (qty <= 0) delete next[key];
      else next[key] = qty;
      items.value = next;
    }
    if (Object.keys(items.value).length === 0 && Object.keys(miscItems.value).length === 0) {
      customDiscount.value = null;
    }
  }

  function clear(): void {
    items.value = {};
    miscItems.value = {};
    customDiscount.value = null;
  }

  /**
   * Record the sale. Port of confirmPayment(): line totals are scaled to the
   * actually-paid total (discounts distributed proportionally, last line
   * absorbs rounding). Sold counters are derived from transactions, so this
   * only writes the transaction itself.
   */
  async function checkout(
    method: PaymentMethod,
    payments: PaymentLeg[],
  ): Promise<Transaction> {
    const eventId = settings.activeEventId;
    if (!eventId) throw new Error('No active event');
    const t = totals.value;
    const local = data.hasLocalCurrency;
    const rate = chargeRate.value;

    const baseItems = distributeTotal(
      lines.value.map((l) => ({
        pid: l.pid,
        vid: l.vid,
        title: l.title,
        variantLabel: l.variantLabel ?? undefined,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
      t.grandTotal,
    );

    const txItems = local
      ? distributeTotal(
          chargeLines.value.map((l) => ({
            pid: l.pid,
            vid: l.vid,
            title: l.title,
            variantLabel: l.variantLabel ?? undefined,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
          chargeGrandTotal.value,
        ).map((item, i) => ({
          ...item,
          baseUnitPrice: baseItems[i].unitPrice,
          baseLineTotal: baseItems[i].lineTotal,
        }))
      : baseItems;

    const chargedTotal = local ? chargeGrandTotal.value : t.grandTotal;

    const tx: Transaction = {
      id: uuidv7(),
      eventId,
      deviceId: settings.deviceId,
      timestamp: Date.now(),
      method,
      payments: payments.length
        ? payments
        : [{ kind: method === 'cash' ? 'cash' : 'card', amount: chargedTotal }],
      items: txItems,
      discounts: [
        ...t.ruleDiscounts.map((r) => ({
          id: r.rule.id,
          name: r.rule.name,
          amount: local ? round2(r.amount * rate) : r.amount,
        })),
        ...(t.customDiscountAmount > 0.001
          ? [
              {
                name: customDiscount.value?.name || 'Custom discount',
                amount: local ? round2(t.customDiscountAmount * rate) : t.customDiscountAmount,
                custom: true,
              },
            ]
          : []),
      ],
      total: chargedTotal,
      currency: chargeCurrency.value,
      ...(local
        ? { baseCurrency: data.currency, baseTotal: t.grandTotal, exchangeRate: rate }
        : {}),
    };

    await recordTransaction(tx);
    clear();
    return tx;
  }

  return {
    items,
    customDiscount,
    lines,
    itemCount,
    totals,
    chargeCurrency,
    chargeRate,
    chargeIncrement,
    chargeLines,
    chargeSubtotal,
    chargeDiscountTotal,
    chargeGrandTotal,
    chargeRoundingAdjustment,
    inCart,
    remaining,
    add,
    addMisc,
    setQty,
    clear,
    checkout,
  };
});
