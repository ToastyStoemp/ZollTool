import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { SalesEvent, Transaction } from '@zolltool/shared';
import type { JwtClaims } from '../auth';
import { reduceEvents, reduceTransactions, type ReducibleOp } from '../reduce';

/**
 * Read-only data API — exposes an account's events and transactions,
 * materialized from the op-log (see reduce.ts). Backs external tooling such as
 * the accounting bridge, which matches conventions to ZollTool events. Every
 * route is JWT-authenticated and scoped to the caller's own account; the tool
 * logs in with a dedicated account's credentials via /api/auth/login.
 */

interface OpRow {
  type: string;
  payload: string;
  opId: string;
}

/** Load the account's ops of the given types, seq-ordered, with payloads parsed. */
function loadOps(db: Database.Database, accountId: string, types: string[]): ReducibleOp[] {
  const placeholders = types.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT type, payload, opId FROM ops WHERE accountId = ? AND type IN (${placeholders}) ORDER BY seq ASC`)
    .all(accountId, ...types) as OpRow[];
  return rows.map((r) => ({ type: r.type, opId: r.opId, payload: JSON.parse(r.payload) as unknown }));
}

const dayStart = (d: string): number => Date.parse(/T/.test(d) ? d : `${d}T00:00:00`);
const dayEnd = (d: string): number => Date.parse(/T/.test(d) ? d : `${d}T23:59:59.999`);

export function registerDataRoutes(app: FastifyInstance, db: Database.Database): void {
  // Current (non-deleted) events for the account.
  app.get('/api/data/events', { preHandler: app.authenticate }, async (req): Promise<SalesEvent[]> => {
    const claims = req.user as JwtClaims;
    const ops = loadOps(db, claims.accountId, ['event.upsert', 'event.close']);
    return reduceEvents(ops).filter((e) => !e.deletedAt);
  });

  // Transactions belonging to one event.
  app.get(
    '/api/data/events/:eventId/transactions',
    { preHandler: app.authenticate },
    async (req): Promise<Transaction[]> => {
      const claims = req.user as JwtClaims;
      const { eventId } = req.params as { eventId: string };
      const ops = loadOps(db, claims.accountId, ['tx.create', 'tx.revert']);
      return reduceTransactions(ops).filter((t) => t.eventId === eventId);
    },
  );

  // Transactions across all events, optionally windowed by timestamp.
  app.get('/api/data/transactions', { preHandler: app.authenticate }, async (req): Promise<Transaction[]> => {
    const claims = req.user as JwtClaims;
    const { from, to } = req.query as { from?: string; to?: string };
    const fromTs = from ? dayStart(from) : -Infinity;
    const toTs = to ? dayEnd(to) : Infinity;
    const ops = loadOps(db, claims.accountId, ['tx.create', 'tx.revert']);
    return reduceTransactions(ops).filter((t) => t.timestamp >= fromTs && t.timestamp <= toTs);
  });
}
