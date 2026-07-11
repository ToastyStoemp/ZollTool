import { Zip, ZipPassThrough, unzipSync, strFromU8, strToU8 } from 'fflate';
import type { DiscountRule, EventStock, OpType, Product, SalesEvent, Transaction } from '@zolltool/shared';
import { db, type ImageRec } from '@/db/schema';
import { appendOps, getSetting } from '@/db/repo';
import { importV1State } from '@/db/migrate-v1';
import { base64ToBlob, blobToBase64 } from '@/lib/images';

/**
 * Two backup shapes:
 *  - JSON  (`exportBackupJson`): everything except photo binaries — small and
 *    reliable. Product photos are omitted (only their metadata is kept), so the
 *    payload never bloats into the multi-MB string that broke the old export.
 *  - ZIP   (`exportBackupZip`): the same JSON plus every photo as a real file,
 *    so a full restore (including images) round-trips.
 */
export interface BackupFile {
  version: 2;
  exportedAt: string;
  events: SalesEvent[];
  products: Product[];
  eventStock: EventStock[];
  transactions: Transaction[];
  discounts: DiscountRule[];
  images: BackupImageMeta[];
}

export interface BackupImageMeta {
  id: string;
  productId: string;
  updatedAt: number;
}

/** Old v2 exports embedded photo binaries inline; still read them on import. */
type BackupImageLegacy = BackupImageMeta & { fullB64?: string; thumbB64?: string };

const ZIP_IMAGE_RE = /^images\/(.+)\.(full|thumb)$/;

async function readBackupData(): Promise<BackupFile> {
  const [events, products, eventStock, transactions, discounts] = await Promise.all([
    db.events.toArray(),
    db.products.toArray(),
    db.eventStock.toArray(),
    db.transactions.toArray(),
    db.discounts.toArray(),
  ]);

  // Image metadata only — .each keeps a single record (and its blobs) alive at
  // a time instead of materializing every photo like toArray() would.
  const images: BackupImageMeta[] = [];
  await db.images.each((r) => images.push({ id: r.id, productId: r.productId, updatedAt: r.updatedAt }));

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    events,
    products,
    eventStock,
    transactions,
    discounts,
    images,
  };
}

/** Data-only JSON backup — small and reliable; product photos are not included. */
export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await readBackupData());
}

/**
 * Stream the full .zip backup (backup.json + every photo) into `sink` in
 * bounded chunks: one photo in memory at a time, entries stored uncompressed
 * (JPEG/WebP are already compressed). Old Android WebViews crash if the whole
 * archive (plus its bridge base64) is materialized at once — this never does.
 */
export async function exportBackupZipTo(sink: { write(chunk: Uint8Array): Promise<void> }): Promise<void> {
  const backup = await readBackupData();

  let zipError: Error | null = null;
  const pending: Uint8Array[] = [];
  const zip = new Zip((err, chunk) => {
    if (err) zipError = err;
    else pending.push(chunk);
  });

  // fflate emits synchronously on push; drain the queue with awaits after each
  // file so at most one entry's chunks are buffered.
  const addFile = async (name: string, data: Uint8Array): Promise<void> => {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(data, true);
    if (zipError) throw zipError;
    while (pending.length) await sink.write(pending.shift()!);
  };

  await addFile('backup.json', strToU8(JSON.stringify(backup)));
  for (const meta of backup.images) {
    const rec = await db.images.get(meta.id);
    if (!rec) continue;
    await addFile(`images/${rec.id}.full`, new Uint8Array(await rec.full.arrayBuffer()));
    await addFile(`images/${rec.id}.thumb`, new Uint8Array(await rec.thumb.arrayBuffer()));
  }

  zip.end();
  if (zipError) throw zipError;
  while (pending.length) await sink.write(pending.shift()!);
}

/** Full backup as one in-memory Uint8Array — web fallback and tests. */
export async function exportBackupZip(): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  await exportBackupZipTo({
    async write(chunk) {
      parts.push(chunk);
      total += chunk.length;
    },
  });
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export interface ImportCounts {
  events: number;
  products: number;
  eventStock: number;
  transactions: number;
  discounts: number;
  images: number;
}

/** Legacy save files are the raw v1 state object — no version field. */
function looksLikeV1State(parsed: unknown): parsed is Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object') return false;
  const p = parsed as Record<string, unknown>;
  return !('version' in p) && (Array.isArray(p.products) || typeof p.meta === 'object');
}

/**
 * Restore a JSON backup. Accepts the current data-only JSON, older v2 exports
 * that embedded photos inline, and ZollTool v1 save files. Records are matched
 * by id, so re-importing is safe and existing unrelated data is untouched.
 */
export async function importBackup(json: string): Promise<ImportCounts> {
  let backup: unknown;
  try {
    backup = JSON.parse(json);
  } catch {
    throw new Error('Not a valid JSON file');
  }
  return applyBackup(backup);
}

/**
 * Restore a full .zip backup (backup.json + images/), reconstructing photos
 * from the packaged files.
 */
export async function importBackupZip(data: Uint8Array): Promise<ImportCounts> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error('Not a valid zip file');
  }
  const jsonBytes = files['backup.json'];
  if (!jsonBytes) throw new Error('Not a ZollTool zip backup');

  const blobs = new Map<string, { full?: Blob; thumb?: Blob }>();
  for (const [name, bytes] of Object.entries(files)) {
    const m = name.match(ZIP_IMAGE_RE);
    if (!m) continue;
    const entry = blobs.get(m[1]) ?? {};
    const part = bytes as unknown as BlobPart;
    if (m[2] === 'full') entry.full = new Blob([part], { type: 'image/jpeg' });
    else entry.thumb = new Blob([part], { type: 'image/webp' });
    blobs.set(m[1], entry);
  }

  return applyBackup(JSON.parse(strFromU8(jsonBytes)), blobs);
}

/**
 * Shared restore. Photo binaries come from the zip (`imageBlobs`) when present,
 * else from inline base64 in an older backup, else the photo is skipped.
 *
 * Every imported record is also queued as a sync op, so a restore reaches the
 * server and other devices like any other change (remote apply is
 * insert-if-absent / last-writer-wins, so replays converge).
 */
async function applyBackup(
  parsed: unknown,
  imageBlobs?: Map<string, { full?: Blob; thumb?: Blob }>,
): Promise<ImportCounts> {
  if (looksLikeV1State(parsed)) {
    const deviceId = (await getSetting<string>('deviceId')) ?? 'unknown-device';
    const v1 = parsed as { products?: unknown[]; transactions?: unknown[]; discounts?: unknown[] };
    await importV1State(v1, deviceId);
    return {
      events: 1,
      products: v1.products?.length ?? 0,
      eventStock: v1.products?.length ?? 0,
      transactions: v1.transactions?.length ?? 0,
      discounts: v1.discounts?.length ?? 0,
      images: 0,
    };
  }

  const backup = parsed as BackupFile;
  if (backup.version !== 2 || !Array.isArray(backup.events)) {
    throw new Error('Not a ZollTool backup file');
  }

  // Resolve photos we actually have binaries for (zip files or inline base64).
  const imageRecs: ImageRec[] = [];
  const imageOps: { type: OpType; payload: unknown }[] = [];
  for (const img of (backup.images ?? []) as BackupImageLegacy[]) {
    const zip = imageBlobs?.get(img.id);
    let full: Blob | undefined;
    let thumb: Blob | undefined;
    if (zip?.full && zip?.thumb) {
      full = zip.full;
      thumb = zip.thumb;
    } else if (img.fullB64 && img.thumbB64) {
      full = base64ToBlob(img.fullB64, 'image/jpeg');
      thumb = base64ToBlob(img.thumbB64, 'image/webp');
    }
    if (!full || !thumb) continue;
    imageRecs.push({ id: img.id, productId: img.productId, updatedAt: img.updatedAt, full, thumb });
    imageOps.push({
      type: 'image.meta',
      payload: { imageId: img.id, productId: img.productId, updatedAt: img.updatedAt, thumbB64: await blobToBase64(thumb) },
    });
  }

  await db.transaction(
    'rw',
    [db.events, db.products, db.eventStock, db.transactions, db.discounts, db.images, db.ops, db.settings],
    async () => {
      await db.events.bulkPut(backup.events);
      await db.products.bulkPut(backup.products);
      await db.eventStock.bulkPut(backup.eventStock);
      await db.transactions.bulkPut(backup.transactions);
      await db.discounts.bulkPut(backup.discounts);
      if (imageRecs.length) await db.images.bulkPut(imageRecs);
      await appendOps([
        ...backup.events.map((e) => ({ type: 'event.upsert' as OpType, payload: e })),
        ...backup.products.map((p) => ({ type: 'product.upsert' as OpType, payload: p })),
        ...backup.eventStock.map((s) => ({ type: 'stock.set' as OpType, payload: s })),
        ...backup.transactions.map((t) => ({ type: 'tx.create' as OpType, payload: t })),
        ...backup.discounts.map((d) => ({ type: 'discount.upsert' as OpType, payload: d })),
        ...imageOps,
      ]);
    },
  );

  return {
    events: backup.events.length,
    products: backup.products.length,
    eventStock: backup.eventStock.length,
    transactions: backup.transactions.length,
    discounts: backup.discounts.length,
    images: imageRecs.length,
  };
}
