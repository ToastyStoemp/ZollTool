import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import type { DiscountRule, Product, SalesEvent, Transaction } from '@zolltool/shared';
import { db } from '@/db/schema';
import { setSetting } from '@/db/repo';
import { exportBackupJson, exportBackupZip, importBackupZip } from '@/lib/export/backup-json';

// The node test env has no FileReader; blobToBase64 (used when restoring image ops) needs it.
class FileReaderStub {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buf) => {
        let bin = '';
        for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
        this.result = `data:${blob.type};base64,${btoa(bin)}`;
        this.onload?.();
      })
      .catch(() => this.onerror?.());
  }
}
(globalThis as unknown as { FileReader: unknown }).FileReader = FileReaderStub;

const FULL_BYTES = new Uint8Array([1, 2, 3, 4]);
const THUMB_BYTES = new Uint8Array([9, 8, 7]);

async function seed(): Promise<void> {
  await Promise.all([
    db.events.clear(),
    db.products.clear(),
    db.eventStock.clear(),
    db.transactions.clear(),
    db.discounts.clear(),
    db.images.clear(),
    db.ops.clear(),
  ]);
  await setSetting('deviceId', 'test-device');
  await db.events.put({ id: 'ev1', name: 'Con', venue: { city: 'Basel' }, currency: 'CHF', status: 'active', updatedAt: 1 } as unknown as SalesEvent);
  await db.products.put({ id: 'p1', name: 'Sticker', variants: [], updatedAt: 1 } as unknown as Product);
  await db.eventStock.put({ eventId: 'ev1', productId: 'p1', variantId: '', broughtQty: 10, updatedAt: 1 });
  await db.transactions.put({ id: 't1', eventId: 'ev1', timestamp: 2, items: [], total: 5, currency: 'CHF' } as unknown as Transaction);
  await db.discounts.put({ id: 'd1', updatedAt: 1 } as unknown as DiscountRule);
  await db.images.put({
    id: 'img1',
    productId: 'p1',
    updatedAt: 3,
    full: new Blob([FULL_BYTES], { type: 'image/jpeg' }),
    thumb: new Blob([THUMB_BYTES], { type: 'image/webp' }),
  });
}

beforeEach(seed);

describe('backup export', () => {
  it('JSON export carries the data but no photo binaries', async () => {
    const json = await exportBackupJson();
    const parsed = JSON.parse(json);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.products).toHaveLength(1);
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.discounts).toHaveLength(1);
    expect(parsed.eventStock).toHaveLength(1);
    // image metadata is kept, but the heavy base64 is not
    expect(parsed.images).toEqual([{ id: 'img1', productId: 'p1', updatedAt: 3 }]);
    expect(json).not.toContain('fullB64');
    expect(json).not.toContain('thumbB64');
  });

  it('ZIP export bundles backup.json plus each photo as a file', async () => {
    const files = unzipSync(await exportBackupZip());
    expect(Object.keys(files).sort()).toEqual(['backup.json', 'images/img1.full', 'images/img1.thumb']);
    expect(Array.from(files['images/img1.full'])).toEqual(Array.from(FULL_BYTES));
    expect(Array.from(files['images/img1.thumb'])).toEqual(Array.from(THUMB_BYTES));
  });
});

describe('backup import (zip round-trip)', () => {
  it('restores data and photo binaries from a zip', async () => {
    const zip = await exportBackupZip();
    await db.images.clear();
    await db.products.clear();

    const counts = await importBackupZip(zip);
    expect(counts).toMatchObject({ events: 1, products: 1, transactions: 1, discounts: 1, eventStock: 1, images: 1 });

    const rec = await db.images.get('img1');
    expect(rec).toBeTruthy();
    expect(Array.from(new Uint8Array(await rec!.full.arrayBuffer()))).toEqual(Array.from(FULL_BYTES));
    expect(Array.from(new Uint8Array(await rec!.thumb.arrayBuffer()))).toEqual(Array.from(THUMB_BYTES));
    // the restore is queued for sync (image.meta op carries the thumbnail)
    const imageOps = (await db.ops.toArray()).filter((o) => o.type === 'image.meta');
    expect(imageOps).toHaveLength(1);
  });
});
