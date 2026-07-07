export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function fmtAmount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(2);
}

export function fmtPrice(n: number | null | undefined, currency: string): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${currency} ${n.toFixed(2)}`;
}
