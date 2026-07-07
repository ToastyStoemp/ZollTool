import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JwtClaims } from '../auth';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ID_RE = /^[\w-]+$/;

/** Full-size product images: thumbnails travel inline in ops, fulls live here. */
export function registerImageRoutes(app: FastifyInstance, db: Database.Database, dataDir: string): void {
  const imagePath = (accountId: string, id: string) => {
    const dir = join(dataDir, 'images', accountId);
    mkdirSync(dir, { recursive: true });
    return join(dir, id);
  };

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

    await writeFile(imagePath(claims.accountId, id), body);
    const mime = req.headers['content-type'] || 'image/jpeg';
    db.prepare(
      `INSERT INTO images (id, accountId, mime, size, updatedAt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id, accountId) DO UPDATE SET mime = excluded.mime, size = excluded.size, updatedAt = excluded.updatedAt`,
    ).run(id, claims.accountId, mime, body.length, Date.now());
    return { ok: true };
  });

  app.get('/api/images/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const claims = req.user as JwtClaims;
    const { id } = req.params as { id: string };
    if (!ID_RE.test(id)) return reply.code(400).send({ error: 'Bad image id' });
    const row = db.prepare('SELECT mime FROM images WHERE id = ? AND accountId = ?').get(id, claims.accountId) as
      | { mime: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    const buf = await readFile(imagePath(claims.accountId, id));
    return reply.type(row.mime).send(buf);
  });
}
