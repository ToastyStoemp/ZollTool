import { describe, expect, it } from 'vitest';
import { cashShortcutAmounts, splitCashPortionAmounts } from '../cash';

describe('cashShortcutAmounts', () => {
  it('CHF 37 → four nearest bill combinations above the total', () => {
    // CHF bills [10,20,50,100,200]: 20+20=40, 50, 10+50=60, 20+50=70, …
    expect(cashShortcutAmounts(37, 'CHF')).toEqual([40, 50, 60, 70]);
  });

  it('EUR 12 → small notes first', () => {
    // EUR bills [5,10,20,50,…]: 5+10=15, 20, 5+20=25, 10+20=30
    expect(cashShortcutAmounts(12, 'EUR')).toEqual([15, 20, 25, 30]);
  });

  it('falls back to default bills for unknown currency', () => {
    expect(cashShortcutAmounts(3, 'XXX')[0]).toBe(5);
  });
});

describe('splitCashPortionAmounts', () => {
  it('offers bills below total plus quarter fractions', () => {
    // total 60 CHF: bills below → 10,20,50; fractions → 15,30,45 → sorted, max 5
    expect(splitCashPortionAmounts(60, 'CHF')).toEqual([10, 15, 20, 30, 45]);
  });
});
