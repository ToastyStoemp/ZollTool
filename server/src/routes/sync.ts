import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { PushRequestSchema, type PullResponse, type PushResponse, type ServerOp } from '@zolltool/shared';
import type { JwtClaims } from '../auth';
import { bumpMetric, touchDevice } from '../db';
import type { Rooms } from '../ws';

export function registerSyncRoutes(app: FastifyInstance, db: Database.Database, rooms: Rooms): void {
  const insertOp = db.prepare(
    `INSERT OR IGNORE INTO ops (accountId, seq, opId, deviceId, ts, type, payload, receivedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const maxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM ops WHERE accountId = ?');

  app.post('/api/sync/push', { preHandler: app.authenticate }, async (req, reply) => {
    const claims = req.user as JwtClaims;
    const parsed = PushRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid push' });
    const { deviceId, deviceName, flavor, ops } = parsed.data;

    let accepted = 0;
    let txCount = 0;
    const result = db.transaction((): PushResponse => {
      let seq = (maxSeq.get(claims.accountId) as { m: number }).m;
      for (const op of ops) {
        const r = insertOp.run(
          claims.accountId,
          seq + 1,
          op.opId,
          op.deviceId,
          op.ts,
          op.type,
          JSON.stringify(op.payload ?? null),
          Date.now(),
        );
        if (r.changes > 0) {
          seq++;
          accepted++;
          if (op.type === 'tx.create') txCount++;
        }
      }
      touchDevice(db, deviceId, claims.accountId, claims.sub, deviceName ?? null, flavor ?? null, Date.now());
      return { accepted, duplicates: ops.length - accepted, latestSeq: seq };
    })();

    bumpMetric(db, claims.accountId, 'syncPushes');
    if (accepted > 0) {
      bumpMetric(db, claims.accountId, 'opsReceived', accepted);
      if (txCount > 0) bumpMetric(db, claims.accountId, 'txCount', txCount);
      rooms.nudge(claims.accountId, result.latestSeq, deviceId);
    }
    return result;
  });

  app.get('/api/sync/pull', { preHandler: app.authenticate }, async (req) => {
    const claims = req.user as JwtClaims;
    const since = Number((req.query as { since?: string }).since ?? 0) || 0;
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 500) || 500, 1000);

    const rows = db
      .prepare('SELECT seq, opId, deviceId, ts, type, payload FROM ops WHERE accountId = ? AND seq > ? ORDER BY seq LIMIT ?')
      .all(claims.accountId, since, limit) as {
      seq: number;
      opId: string;
      deviceId: string;
      ts: number;
      type: string;
      payload: string;
    }[];

    const ops: ServerOp[] = rows.map((r) => ({
      serverSeq: r.seq,
      opId: r.opId,
      deviceId: r.deviceId,
      ts: r.ts,
      type: r.type as ServerOp['type'],
      payload: JSON.parse(r.payload),
    }));
    const latestSeq = (maxSeq.get(claims.accountId) as { m: number }).m;
    const response: PullResponse = { ops, latestSeq };
    return response;
  });
}
