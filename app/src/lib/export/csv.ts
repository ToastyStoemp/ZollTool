import type { Transaction } from '@zolltool/shared';

function esc(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Same column layout as the legacy history.html exportCSV(). */
export function transactionsToCsv(transactions: Transaction[]): string {
  const header = [
    'timestamp',
    'method',
    'payment_cash',
    'payment_card',
    'total',
    'currency',
    'product',
    'variant',
    'qty',
    'unit_price',
    'line_total',
    'reverted',
  ];
  const rows: string[] = [header.join(',')];

  for (const tx of transactions) {
    const cash = tx.payments.filter((p) => p.kind === 'cash').reduce((s, p) => s + p.amount, 0);
    const card = tx.payments.filter((p) => p.kind === 'card').reduce((s, p) => s + p.amount, 0);
    for (const item of tx.items) {
      rows.push(
        [
          esc(new Date(tx.timestamp).toISOString()),
          esc(tx.method),
          cash.toFixed(2),
          card.toFixed(2),
          tx.total.toFixed(2),
          esc(tx.currency),
          esc(item.title),
          esc(item.variantLabel ?? ''),
          item.qty,
          (item.unitPrice ?? 0).toFixed(2),
          item.lineTotal.toFixed(2),
          tx.revertedBy ? 'yes' : 'no',
        ].join(','),
      );
    }
  }
  return rows.join('\n');
}
