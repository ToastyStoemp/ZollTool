import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JwtClaims } from '../auth';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ID_RE = /^[\w-]+$/;

/** Absolute path of an account's full-size image on disk (creates the dir). */
export function imagePath(dataDir: string, accountId: string, id: string): string {
  const dir = join(dataDir, 'images', accountId);
  mkdirSync(dir, { recursive: true });
  return join(dir, id);
}

/**
 * Persist a full-size image (bytes on disk + a row in `images`). Shared by the
 * device upload route and the external catalog write API (Shopify sync).
 */
export async function storeFullImage(
  db: Database.Database,
  dataDir: string,
  accountId: string,
  id: string,
  body: Buffer,
  mime: string,
): Promise<void> {
  await writeFile(imagePath(dataDir, accountId, id), body);
  db.prepare(
    `INSERT INTO images (id, accountId, mime, size, updatedAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id, accountId) DO UPDATE SET mime = excluded.mime, size = excluded.size, updatedAt = excluded.updatedAt`,
  ).run(id, accountId, mime, body.length, Date.now());
}

/** Full-size product images: thumbnails travel inline in ops, fulls live here. */
export function registerImageRoutes(app: FastifyInstance, db: Database.Database, dataDir: string): void {

  app.addContentTypeParser(['image/jpeg', 'image/webp', 'image/png', 'application/octet-stream'], {
    parseAs: 'buffer',
    bodyLimit: MAX_IMAGE_BYTES,
  }, (_req, body, done) => done(null, body));

  app.put('/api/images/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const claims = req.user as JwtClaims;
    const { id } = req.params as { id: string };
    if (!ID_RE.test(id)) return reply.code(400).send({ error: 'Bad image id' });
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: 'Empty body' });

    const mime = req.headers['content-type'] || 'image/jpeg';
    await storeFullImage(db, dataDir, claims.accountId, id, body, mime);
    return { ok: true };
  });

  // Read-scope tokens may fetch images too, so back-office tooling can preview
  // the current ZollTool artwork alongside the Shopify catalog.
  app.get('/api/images/:id', { preHandler: app.authenticateApiOrJwt }, async (req, reply) => {
    const claims = req.user as JwtClaims;
    const { id } = req.params as { id: string };
    if (!ID_RE.test(id)) return reply.code(400).send({ error: 'Bad image id' });
    const row = db.prepare('SELECT mime FROM images WHERE id = ? AND accountId = ?').get(id, claims.accountId) as
      | { mime: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    const buf = await readFile(imagePath(dataDir, claims.accountId, id));
    return reply.type(row.mime).send(buf);
  });
}
