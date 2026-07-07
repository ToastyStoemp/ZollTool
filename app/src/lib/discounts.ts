import type { DiscountRule } from '@zolltool/shared';

/** A resolved cart line: variant lines carry vid, plain products vid=null. */
export interface CartLine {
  pid: string;
  vid: string | null;
  title: string;
  variantLabel: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface RuleDiscountResult {
  rule: DiscountRule;
  amount: number;
}

export interface CustomDiscount {
  type: 'percent' | 'amount';
  value: number;
  name: string;
}

function ruleTargetsLine(rule: DiscountRule, line: CartLine): boolean {
  if (rule.productIds.includes(line.pid)) return true;
  if (line.vid && rule.variantIds.includes(`${line.pid}:${line.vid}`)) return true;
  return false;
}

/**
 * Port of pos.html calculateDiscounts(): for each rule, collect the unit price
 * of every matching item (expanded per quantity), sort cheapest-first, and
 * apply the rule's math. Ported behavior is preserved exactly:
 * - bxgy: floor(n / (buy+free)) * free cheapest items go free
 * - nth_pct: every nth item (cheapest-first order) gets percent off
 * - tiered: greedy largest-tier grouping; remainder at avg unit price, or at
 *   the best tier's unit price when tierContinue is set; needs >= 2 items
 */
export function computeRuleDiscounts(lines: CartLine[], rules: DiscountRule[]): RuleDiscountResult[] {
  const results: RuleDiscountResult[] = [];
  for (const rule of rules) {
    if (rule.deletedAt) continue;
    if (!rule.productIds.length && !rule.variantIds.length) continue;

    const items: number[] = [];
    for (const line of lines) {
      if (!line.qty || !ruleTargetsLine(rule, line)) continue;
      for (let i = 0; i < line.qty; i++) items.push(line.unitPrice || 0);
    }
    if (!items.length) continue;

    items.sort((a, b) => a - b);
    const totalQty = items.length;
    let amount = 0;

    if (rule.type === 'bxgy') {
      const groupSize = (rule.buyQty || 2) + (rule.freeQty || 1);
      const freeCount = Math.floor(totalQty / groupSize) * (rule.freeQty || 1);
      for (let i = 0; i < freeCount; i++) amount += items[i] || 0;
    } else if (rule.type === 'nth_pct') {
      const nth = rule.nth || 3;
      const pct = (rule.percent || 50) / 100;
      for (let i = nth - 1; i < totalQty; i += nth) amount += (items[i] || 0) * pct;
    } else if (rule.type === 'tiered') {
      if (!rule.tiers || !rule.tiers.length) continue;
      if (totalQty < 2) continue;
      const normalTotal = items.reduce((s, v) => s + v, 0);
      const avgUnit = normalTotal / totalQty;
      const sortedTiers = [...rule.tiers].sort((a, b) => b.qty - a.qty);
      let remaining = totalQty;
      let tieredTotal = 0;
      for (const tier of sortedTiers) {
        const groups = Math.floor(remaining / tier.qty);
        if (groups > 0) {
          tieredTotal += groups * tier.total;
          remaining -= groups * tier.qty;
        }
      }
      const maxTier = sortedTiers[0]!;
      const remainderUnit = rule.tierContinue ? maxTier.total / maxTier.qty : avgUnit;
      tieredTotal += remaining * remainderUnit;
      amount = normalTotal - tieredTotal;
    }

    if (amount > 0.001) results.push({ rule, amount });
  }
  return results;
}

/** Port of calculateCartDiscount(): custom discount applied after rule discounts. */
export function computeCustomDiscount(baseTotal: number, discount: CustomDiscount | null): number {
  if (!discount || !baseTotal) return 0;
  const value = discount.value || 0;
  if (value <= 0) return 0;
  if (discount.type === 'percent') {
    return Math.min(baseTotal, (baseTotal * Math.min(value, 100)) / 100);
  }
  return Math.min(baseTotal, value);
}

export interface CartTotals {
  subtotal: number;
  ruleDiscounts: RuleDiscountResult[];
  ruleDiscountTotal: number;
  customDiscountAmount: number;
  grandTotal: number;
}

/** Port of cartGrandTotal(): subtotal − rule discounts − custom discount, floored at 0. */
export function computeCartTotals(
  lines: CartLine[],
  rules: DiscountRule[],
  custom: CustomDiscount | null,
): CartTotals {
  const subtotal = lines.reduce((s, l) => s + (l.lineTotal || 0), 0);
  const ruleDiscounts = computeRuleDiscounts(lines, rules);
  const ruleDiscountTotal = ruleDiscounts.reduce((s, r) => s + r.amount, 0);
  const afterRules = Math.max(0, subtotal - ruleDiscountTotal);
  const customDiscountAmount = computeCustomDiscount(afterRules, custom);
  const grandTotal = Math.max(0, afterRules - customDiscountAmount);
  return { subtotal, ruleDiscounts, ruleDiscountTotal, customDiscountAmount, grandTotal };
}

/**
 * Port of confirmPayment() step 3: scale line totals proportionally to the
 * actually-paid total; the last line absorbs cent-level rounding drift.
 * Mutates and returns the lines.
 */
export function distributeTotal<T extends { lineTotal: number }>(lines: T[], actualTotal: number): T[] {
  const subtotal = lines.reduce((s, l) => s + (l.lineTotal || 0), 0);
  if (subtotal > 0.001 && Math.abs(actualTotal - subtotal) > 0.001) {
    const ratio = actualTotal / subtotal;
    let distributed = 0;
    lines.forEach((line, i) => {
      if (i < lines.length - 1) {
        line.lineTotal = Math.round(line.lineTotal * ratio * 100) / 100;
        distributed += line.lineTotal;
      } else {
        line.lineTotal = Math.round((actualTotal - distributed) * 100) / 100;
      }
    });
  }
  return lines;
}
