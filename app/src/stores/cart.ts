import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { PaymentLeg, PaymentMethod, Transaction } from '@zolltool/shared';
import {
  computeCartTotals,
  distributeTotal,
  type CartLine,
  type CustomDiscount,
} from '@/lib/discounts';
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

  const lines = computed<CartLine[]>(() => {
    const result: CartLine[] = [];
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

  const itemCount = computed(() => Object.values(items.value).reduce((s, q) => s + q, 0));

  const totals = computed(() =>
    computeCartTotals(lines.value, data.discounts, customDiscount.value),
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

  function setQty(key: string, qty: number): void {
    const next = { ...items.value };
    if (qty <= 0) delete next[key];
    else next[key] = qty;
    items.value = next;
    if (Object.keys(next).length === 0) customDiscount.value = null;
  }

  function clear(): void {
    items.value = {};
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

    const txItems = distributeTotal(
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

    const tx: Transaction = {
      id: uuidv7(),
      eventId,
      deviceId: settings.deviceId,
      timestamp: Date.now(),
      method,
      payments: payments.length ? payments : [{ kind: method === 'cash' ? 'cash' : 'card', amount: t.grandTotal }],
      items: txItems,
      discounts: [
        ...t.ruleDiscounts.map((r) => ({ id: r.rule.id, name: r.rule.name, amount: r.amount })),
        ...(t.customDiscountAmount > 0.001
          ? [
              {
                name: customDiscount.value?.name || 'Custom discount',
                amount: t.customDiscountAmount,
                custom: true,
              },
            ]
          : []),
      ],
      total: t.grandTotal,
      currency: data.currency,
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
    inCart,
    remaining,
    add,
    setQty,
    clear,
    checkout,
  };
});
