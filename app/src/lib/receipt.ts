import type { Transaction } from '@zolltool/shared';
import { getSetting } from '@/db/repo';
import { fmtPrice } from '@/lib/money';

/**
 * Receipt building for the myPOS Carbon's built-in thermal printer (carbon
 * flavor). Lines are pre-formatted here for the 32-character paper width and
 * handed to CarbonPaymentPlugin.printReceipt, which maps them to Smart-SDK
 * PrinterCommands.
 */

export interface ReceiptLine {
  kind: 'text' | 'image' | 'space';
  text?: string;
  align?: 'left' | 'center' | 'right';
  doubleHeight?: boolean;
  imageB64?: string;
}

/** Stored under the 'customs.artistDefaults' setting (shared with customs prefill). */
export interface ArtistInfo {
  companyName?: string;
  fullName?: string;
  street?: string;
  postCodeCity?: string;
  countryOfOrigin?: string;
  phone?: string;
  email?: string;
  /** VAT / UID number printed on receipts, e.g. CHE-123.456.789 MWST */
  vatNumber?: string;
}

export const RECEIPT_KEYS = {
  artist: 'customs.artistDefaults',
  logoB64: 'receipt.logoB64',
  footerText: 'receipt.footerText',
  autoPrint: 'receipt.autoPrint',
} as const;

/** Printable width of the Carbon paper in characters (myPOS "Smart" format). */
const WIDTH = 32;
/** Thermal print head width in pixels. */
export const LOGO_MAX_PX = 384;

const DIVIDER = '-'.repeat(WIDTH);

/** Left+right text on one 32-char line; the right side wins when space runs out. */
function row(left: string, right: string): string {
  const space = WIDTH - right.length - 1;
  const l = left.length > space ? left.slice(0, Math.max(0, space - 1)) + '…' : left;
  return l + ' '.repeat(Math.max(1, WIDTH - l.length - right.length)) + right;
}

export async function loadReceiptConfig(): Promise<{
  artist: ArtistInfo;
  logoB64: string;
  footerText: string;
  autoPrint: boolean;
}> {
  return {
    artist: (await getSetting<ArtistInfo>(RECEIPT_KEYS.artist)) ?? {},
    logoB64: (await getSetting<string>(RECEIPT_KEYS.logoB64)) ?? '',
    footerText: (await getSetting<string>(RECEIPT_KEYS.footerText)) ?? '',
    autoPrint: (await getSetting<boolean>(RECEIPT_KEYS.autoPrint)) ?? false,
  };
}

export function buildReceiptLines(
  tx: Transaction,
  eventName: string,
  config: { artist: ArtistInfo; logoB64: string; footerText: string },
): ReceiptLine[] {
  const { artist, logoB64, footerText } = config;
  const lines: ReceiptLine[] = [];
  const center = (text: string): ReceiptLine => ({ kind: 'text', text, align: 'center' });

  // ── Header: logo + artist block ──
  if (logoB64) lines.push({ kind: 'image', imageB64: logoB64 });
  if (artist.companyName) lines.push({ ...center(artist.companyName), doubleHeight: true });
  if (artist.fullName && artist.fullName !== artist.companyName) lines.push(center(artist.fullName));
  if (artist.street) lines.push(center(artist.street));
  const cityLine = [artist.postCodeCity, artist.countryOfOrigin].filter(Boolean).join(', ');
  if (cityLine) lines.push(center(cityLine));
  if (artist.phone) lines.push(center(artist.phone));
  if (artist.email) lines.push(center(artist.email));
  if (artist.vatNumber) lines.push(center(`VAT: ${artist.vatNumber}`));

  lines.push({ kind: 'text', text: DIVIDER });
  const when = new Date(tx.timestamp);
  lines.push({ kind: 'text', text: row(eventName, when.toLocaleDateString('de-CH')) });
  lines.push({ kind: 'text', text: row('', when.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })) });
  lines.push({ kind: 'text', text: DIVIDER });

  // ── Items ──
  for (const item of tx.items) {
    const name = item.variantLabel ? `${item.title} (${item.variantLabel})` : item.title;
    lines.push({ kind: 'text', text: row(`${item.qty} x ${name}`, fmtPrice(item.lineTotal, tx.currency)) });
    if (item.qty > 1) {
      lines.push({ kind: 'text', text: `   à ${fmtPrice(item.unitPrice, tx.currency)}` });
    }
  }
  for (const d of tx.discounts) {
    lines.push({ kind: 'text', text: row(d.name, `-${fmtPrice(d.amount, tx.currency)}`) });
  }

  lines.push({ kind: 'text', text: DIVIDER });
  lines.push({ kind: 'text', text: row('TOTAL', fmtPrice(tx.total, tx.currency)), doubleHeight: true });

  // ── Payment legs ──
  for (const leg of tx.payments) {
    const label =
      leg.kind === 'cash' ? 'Cash' : leg.provider && leg.provider !== 'card' ? leg.provider : 'Card';
    lines.push({ kind: 'text', text: row(label, fmtPrice(leg.amount, tx.currency)) });
    if (leg.cardBrand || leg.authCode) {
      lines.push({
        kind: 'text',
        text: `  ${[leg.cardBrand, leg.authCode ? `auth ${leg.authCode}` : ''].filter(Boolean).join(' · ')}`,
      });
    }
  }

  // ── Footer ──
  lines.push({ kind: 'space' });
  if (footerText) {
    for (const part of footerText.split('\n')) lines.push(center(part));
  }
  lines.push(center(`Receipt ${tx.id.slice(-8)}`));
  lines.push({ kind: 'space' });
  lines.push({ kind: 'space' });

  return lines;
}

/**
 * Prepare a picked logo image for thermal printing: scale to the 384px head
 * width and flatten onto white (transparent pixels would print black).
 * Returns base64 PNG without the data: prefix.
 */
export async function processLogoFile(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LOGO_MAX_PX / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}
