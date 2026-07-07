import type { DiscountRule, EventStock, Product, SalesEvent, Transaction } from '@zolltool/shared';
import { db } from '@/db/schema';
import { base64ToBlob, blobToBase64 } from '@/lib/images';

/** Full-data backup: everything needed to rebuild the local database on another device. */
export interface BackupFile {
  version: 2;
  exportedAt: string;
  events: SalesEvent[];
  products: Product[];
  eventStock: EventStock[];
  transactions: Transaction[];
  discounts: DiscountRule[];
  images: BackupImage[];
}

interface BackupImage {
  id: string;
  productId: string;
  updatedAt: number;
  fullB64: string;
  thumbB64: string;
}

export async function exportBackup(): Promise<string> {
  const [events, products, eventStock, transactions, discounts, imageRecs] = await Promise.all([
    db.events.toArray(),
    db.products.toArray(),
    db.eventStock.toArray(),
    db.transactions.toArray(),
    db.discounts.toArray(),
    db.images.toArray(),
  ]);

  const images: BackupImage[] = [];
  for (const rec of imageRecs) {
    images.push({
      id: rec.id,
      productId: rec.productId,
      updatedAt: rec.updatedAt,
      fullB64: await blobToBase64(rec.full),
      thumbB64: await blobToBase64(rec.thumb),
    });
  }

  const backup: BackupFile = {
    version: 2,
    exportedAt: new Date().toISOString(),
    events,
    products,
    eventStock,
    transactions,
    discounts,
    images,
  };
  return JSON.stringify(backup);
}

export interface ImportCounts {
  events: number;
  products: number;
  eventStock: number;
  transactions: number;
  discounts: number;
  images: number;
}

/**
 * Merge a backup into the local database. Records are matched by id, so
 * re-importing the same file is safe; existing unrelated data is untouched.
 * Restored data is written directly (no ops appended) — a restore is not a
 * new local change to broadcast.
 */
export async function importBackup(json: string): Promise<ImportCounts> {
  let backup: BackupFile;
  try {
    backup = JSON.parse(json) as BackupFile;
  } catch {
    throw new Error('Not a valid JSON file');
  }
  if (backup.version !== 2 || !Array.isArray(backup.events)) {
    throw new Error('Not a ZollTool v2 backup file');
  }

  await db.transaction('rw', [db.events, db.products, db.eventStock, db.transactions, db.discounts, db.images], async () => {
    await db.events.bulkPut(backup.events);
    await db.products.bulkPut(backup.products);
    await db.eventStock.bulkPut(backup.eventStock);
    await db.transactions.bulkPut(backup.transactions);
    await db.discounts.bulkPut(backup.discounts);
    await db.images.bulkPut(
      (backup.images ?? []).map((img) => ({
        id: img.id,
        productId: img.productId,
        updatedAt: img.updatedAt,
        full: base64ToBlob(img.fullB64, 'image/jpeg'),
        thumb: base64ToBlob(img.thumbB64, 'image/webp'),
      })),
    );
  });

  return {
    events: backup.events.length,
    products: backup.products.length,
    eventStock: backup.eventStock.length,
    transactions: backup.transactions.length,
    discounts: backup.discounts.length,
    images: (backup.images ?? []).length,
  };
}
