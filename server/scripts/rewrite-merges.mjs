#!/usr/bin/env node
/**
 * One-time op-log rewrite: bake product.merge remaps into the stored op payloads,
 * so historical sales carry the merged product/variant ids directly and the
 * remap layer is no longer needed. Bumps each touched account's syncEpoch, which
 * the pull API returns — every device then wipes its local data and re-pulls the
 * rewritten log from scratch (see app/src/sync/engine.ts).
 *
 * DESTRUCTIVE and one-way. Take a DB backup first (you have). Deploy the server
 * + app build that understand `epoch` BEFORE running this, or clients won't
 * resync. Run when devices are online and idle so no offline sale is pending.
 *
 * Usage (from server/):
 *   node scripts/rewrite-merges.mjs --data-dir /path/to/data --all           # dry run
 *   node scripts/rewrite-merges.mjs --data-dir /path/to/data --all --apply    # commit
 *   node scripts/rewrite-merges.mjs --db /path/zolltool.db --account <id> --apply
 *   ... --keep-merge-tombstone   # leave the product.merge ops in place (still safe)
 */
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const apply = flag('apply');
const keepTombstone = flag('keep-merge-tombstone');
const onlyAccount = opt('account');
const dbPath = opt('db') ?? join(opt('data-dir') ?? process.env.DATA_DIR ?? './data', 'zolltool.db');

if (!flag('all') && !onlyAccount) {
  console.error('Refusing to run: pass --account <id> or --all.');
  process.exit(1);
}
if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}\nPass --db <file> or --data-dir <dir>.`);
  process.exit(1);
}

// ── merge helpers (kept in sync with shared/src/merge.ts) ────────────────────
const mergeKey = (pid, vid) => (vid ? `${pid}:${vid}` : pid);

function buildMergeMap(merges) {
  const direct = new Map();
  for (const m of [...merges].sort((a, b) => a.updatedAt - b.updatedAt)) {
    for (const s of m.sources) {
      direct.set(s.fromKey, { pid: s.toPid, vid: s.toVid || null, title: s.title, variantLabel: s.variantLabel });
    }
  }
  const resolved = new Map();
  for (const [fromKey, first] of direct) {
    let t = first;
    const seen = new Set([fromKey]);
    for (;;) {
      const tKey = mergeKey(t.pid, t.vid);
      if (seen.has(tKey)) break;
      const next = direct.get(tKey);
      if (!next) break;
      seen.add(tKey);
      t = next;
    }
    resolved.set(fromKey, t);
  }
  return resolved;
}

const refOf = (map, pid, vid) => map.get(mergeKey(pid, vid)) ?? null;

/** Returns [newPayload|null, changed]. null = leave the row as-is. */
function rewritePayload(type, payload, map) {
  if (!payload) return [null, false];
  let changed = false;

  if (type === 'tx.create') {
    const items = (payload.items ?? []).map((it) => {
      const t = refOf(map, it.pid, it.vid ?? null);
      if (!t) return it;
      changed = true;
      return { ...it, pid: t.pid, vid: t.vid, title: t.title, variantLabel: t.variantLabel };
    });
    return changed ? [{ ...payload, items }, true] : [null, false];
  }

  if (type === 'stock.set') {
    const t = refOf(map, payload.productId, payload.variantId || null);
    if (!t) return [null, false];
    return [{ ...payload, productId: t.pid, variantId: t.vid || '' }, true];
  }

  if (type === 'event.upsert') {
    if (!payload.localPriceOverrides) return [null, false];
    const next = {};
    for (const [k, v] of Object.entries(payload.localPriceOverrides)) {
      const [pid, vid] = k.split(':');
      const t = refOf(map, pid, vid ?? null);
      if (t) { changed = true; next[mergeKey(t.pid, t.vid)] = v; }
      else next[k] = v;
    }
    return changed ? [{ ...payload, localPriceOverrides: next }, true] : [null, false];
  }

  if (type === 'discount.upsert') {
    const variantIds = new Set(payload.variantIds ?? []);
    const productIds = [];
    for (const pid of payload.productIds ?? []) {
      const t = refOf(map, pid, null);
      if (t) { changed = true; variantIds.add(mergeKey(t.pid, t.vid)); }
      else productIds.push(pid);
    }
    for (const vref of payload.variantIds ?? []) {
      const [pid, vid] = vref.split(':');
      const t = refOf(map, pid, vid ?? null);
      if (t) { changed = true; variantIds.delete(vref); variantIds.add(mergeKey(t.pid, t.vid)); }
    }
    return changed ? [{ ...payload, productIds, variantIds: [...variantIds] }, true] : [null, false];
  }

  return [null, false];
}

// ── run ──────────────────────────────────────────────────────────────────────
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Defensive: the syncEpoch column ships in server migration v7, but add it if an
// older schema is being rewritten directly.
const hasEpoch = db.prepare(`PRAGMA table_info(accounts)`).all().some((c) => c.name === 'syncEpoch');
if (!hasEpoch) db.exec('ALTER TABLE accounts ADD COLUMN syncEpoch INTEGER NOT NULL DEFAULT 0');

const accounts = onlyAccount
  ? [{ id: onlyAccount }]
  : db.prepare('SELECT id FROM accounts').all();

const REWRITE_TYPES = ['tx.create', 'stock.set', 'event.upsert', 'discount.upsert'];
const placeholders = REWRITE_TYPES.map(() => '?').join(',');
const selRows = db.prepare(`SELECT seq, type, payload FROM ops WHERE accountId = ? AND type IN (${placeholders}) ORDER BY seq`);
const selMerges = db.prepare(`SELECT payload FROM ops WHERE accountId = ? AND type = 'product.merge'`);
const updRow = db.prepare('UPDATE ops SET payload = ? WHERE accountId = ? AND seq = ?');
const delMerges = db.prepare(`DELETE FROM ops WHERE accountId = ? AND type = 'product.merge'`);
const bumpEpoch = db.prepare('UPDATE accounts SET syncEpoch = ? WHERE id = ?');

let grandTotal = 0;
const epoch = Date.now();

for (const acct of accounts) {
  const merges = selMerges.all(acct.id).map((r) => JSON.parse(r.payload));
  if (!merges.length) continue;
  const map = buildMergeMap(merges);

  const run = db.transaction(() => {
    const counts = {};
    for (const row of selRows.all(acct.id, ...REWRITE_TYPES)) {
      const [next, changed] = rewritePayload(row.type, JSON.parse(row.payload), map);
      if (!changed) continue;
      counts[row.type] = (counts[row.type] ?? 0) + 1;
      if (apply) updRow.run(JSON.stringify(next), acct.id, row.seq);
    }
    const removedMerges = merges.length;
    if (apply) {
      if (!keepTombstone) delMerges.run(acct.id);
      bumpEpoch.run(epoch, acct.id);
    }
    return { counts, removedMerges };
  });

  const { counts, removedMerges } = run();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  grandTotal += total;
  const detail = REWRITE_TYPES.map((t) => `${t}:${counts[t] ?? 0}`).join('  ');
  console.log(
    `account ${acct.id}: ${removedMerges} merge op(s) → rewrote ${total} op(s)  [${detail}]` +
      (keepTombstone ? '  (merge ops kept)' : '  (merge ops removed)'),
  );
}

if (apply) {
  console.log(`\nAPPLIED. Rewrote ${grandTotal} op(s); epoch=${epoch}. Devices will wipe + re-pull on next sync.`);
} else {
  console.log(`\nDRY RUN — nothing written. ${grandTotal} op(s) would change. Re-run with --apply to commit.`);
}
db.close();
