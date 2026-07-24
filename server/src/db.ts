import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SQLite via better-sqlite3 — synchronous, transactional, zero infra.
 * All data lives under DATA_DIR (a Docker volume in production):
 *   DATA_DIR/zolltool.db      the database
 *   DATA_DIR/images/<acct>/   full-size product images
 */

const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE accounts (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );
  CREATE TABLE users (
    id           TEXT PRIMARY KEY,
    accountId    TEXT NOT NULL REFERENCES accounts(id),
    email        TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
    createdAt    INTEGER NOT NULL,
    lastLoginAt  INTEGER
  );
  CREATE TABLE devices (
    id         TEXT PRIMARY KEY,
    accountId  TEXT NOT NULL REFERENCES accounts(id),
    userId     TEXT NOT NULL REFERENCES users(id),
    name       TEXT,
    lastSeenAt INTEGER NOT NULL,
    createdAt  INTEGER NOT NULL
  );
  CREATE TABLE refresh_tokens (
    id        TEXT PRIMARY KEY,
    userId    TEXT NOT NULL REFERENCES users(id),
    tokenHash TEXT NOT NULL UNIQUE,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL
  );
  CREATE TABLE invites (
    code      TEXT PRIMARY KEY,
    accountId TEXT REFERENCES accounts(id),  -- NULL = invite creates a brand-new account
    role      TEXT NOT NULL DEFAULT 'member',
    createdBy TEXT NOT NULL REFERENCES users(id),
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    usedBy    TEXT REFERENCES users(id)
  );
  CREATE TABLE ops (
    accountId  TEXT NOT NULL REFERENCES accounts(id),
    seq        INTEGER NOT NULL,
    opId       TEXT NOT NULL UNIQUE,
    deviceId   TEXT NOT NULL,
    ts         INTEGER NOT NULL,
    type       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    receivedAt INTEGER NOT NULL,
    PRIMARY KEY (accountId, seq)
  );
  CREATE TABLE images (
    id        TEXT NOT NULL,
    accountId TEXT NOT NULL REFERENCES accounts(id),
    mime      TEXT NOT NULL,
    size      INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    PRIMARY KEY (id, accountId)
  );
  CREATE TABLE metrics (
    accountId   TEXT NOT NULL REFERENCES accounts(id),
    day         TEXT NOT NULL,
    logins      INTEGER NOT NULL DEFAULT 0,
    syncPushes  INTEGER NOT NULL DEFAULT 0,
    opsReceived INTEGER NOT NULL DEFAULT 0,
    txCount     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (accountId, day)
  );
  `,
  // v2 — client-uploaded diagnostic logs (see routes/logs.ts)
  `
  CREATE TABLE logs (
    id         TEXT PRIMARY KEY,
    accountId  TEXT NOT NULL REFERENCES accounts(id),
    deviceId   TEXT NOT NULL,
    deviceName TEXT,
    flavor     TEXT,
    appVersion TEXT,
    reason     TEXT,
    size       INTEGER NOT NULL,
    createdAt  INTEGER NOT NULL
  );
  `,
  // v3 — track each device's app flavor, so e.g. a register can list the
  // account's Carbon terminals for the remote-payment-trigger picker.
  `ALTER TABLE devices ADD COLUMN flavor TEXT;`,
];

export function openDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, 'images'), { recursive: true });
  mkdirSync(join(dataDir, 'logs'), { recursive: true });
  const db = new Database(join(dataDir, 'zolltool.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const applied = db.pragma('user_version', { simple: true }) as number;
  for (let v = applied; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

const METRIC_FIELDS = ['logins', 'syncPushes', 'opsReceived', 'txCount'] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];

export function bumpMetric(db: Database.Database, accountId: string, field: MetricField, delta = 1): void {
  if (!METRIC_FIELDS.includes(field)) return;
  const day = new Date().toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO metrics (accountId, day, ${field}) VALUES (?, ?, ?)
     ON CONFLICT (accountId, day) DO UPDATE SET ${field} = ${field} + excluded.${field}`,
  ).run(accountId, day, delta);
}

/**
 * Upsert device presence — called both from a sync push (routes/sync.ts) and
 * a fresh WS connection (ws.ts), since a device that mostly just listens
 * (e.g. a Carbon sitting in customer-display mode) may rarely push its own
 * ops otherwise, leaving its lastSeenAt stale for the device picker.
 */
export function touchDevice(
  db: Database.Database,
  id: string,
  accountId: string,
  userId: string,
  name: string | null,
  flavor: string | null,
  now: number,
): void {
  db.prepare(
    `INSERT INTO devices (id, accountId, userId, name, flavor, lastSeenAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       lastSeenAt = excluded.lastSeenAt,
       name = COALESCE(excluded.name, name),
       flavor = COALESCE(excluded.flavor, flavor)`,
  ).run(id, accountId, userId, name, flavor, now, now);
}
