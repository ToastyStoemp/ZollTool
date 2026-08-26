import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  LoginRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  type AuthUser,
  type TokenResponse,
  type UserRole,
} from '@zolltool/shared';
import { bumpMetric } from './db';

const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

// A valid argon2id hash of a throwaway value. Verified against on login when the
// email is unknown, so a missing user costs the same time as a wrong password —
// closing the timing side-channel that would otherwise reveal which emails exist.
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$LNyRVyktowy+Cb4nmWxqVg$RYqS8odpvRgQmClUelVQI2+sTXtVDEmp7/ejvWlyryA';

export interface JwtClaims {
  sub: string;
  accountId: string;
  role: UserRole;
}

interface UserRow {
  id: string;
  accountId: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function toAuthUser(db: Database.Database, user: UserRow): AuthUser {
  const account = db.prepare('SELECT name FROM accounts WHERE id = ?').get(user.accountId) as { name: string };
  return { id: user.id, email: user.email, role: user.role, accountId: user.accountId, accountName: account.name };
}

async function issueTokens(app: FastifyInstance, db: Database.Database, user: UserRow): Promise<TokenResponse> {
  const claims: JwtClaims = { sub: user.id, accountId: user.accountId, role: user.role };
  const accessToken = app.jwt.sign(claims, { expiresIn: ACCESS_TTL });
  const refreshToken = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO refresh_tokens (id, userId, tokenHash, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(),
    user.id,
    sha256(refreshToken),
    Date.now() + REFRESH_TTL_MS,
    Date.now(),
  );
  return { accessToken, refreshToken, user: toAuthUser(db, user) };
}

function touchDevice(db: Database.Database, accountId: string, userId: string, deviceId?: string, name?: string): void {
  if (!deviceId) return;
  db.prepare(
    `INSERT INTO devices (id, accountId, userId, name, lastSeenAt, createdAt) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET lastSeenAt = excluded.lastSeenAt, name = COALESCE(excluded.name, name)`,
  ).run(deviceId, accountId, userId, name ?? null, Date.now(), Date.now());
}

/** Seed the server owner from env on first boot (OWNER_EMAIL / OWNER_PASSWORD). */
export async function seedOwner(db: Database.Database): Promise<void> {
  const email = process.env.OWNER_EMAIL?.toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) return;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return;
  const accountId = randomUUID();
  db.prepare('INSERT INTO accounts (id, name, createdAt) VALUES (?, ?, ?)').run(accountId, 'Owner', Date.now());
  db.prepare('INSERT INTO users (id, accountId, email, passwordHash, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
    randomUUID(),
    accountId,
    email,
    await argon2.hash(password, { type: argon2.argon2id }),
    'owner',
    Date.now(),
  );
}

export function registerAuthRoutes(app: FastifyInstance, db: Database.Database): void {
  // Caps for the auth surface (per client IP). Login/register run an expensive
  // argon2 hash, so this blunts both password brute-forcing and the CPU-DoS of
  // hammering the hasher. Kept generous enough that a venue full of helper
  // devices behind one NAT/WiFi (shared public IP) isn't locked out at shift
  // start. Read at startup (env), so it's configurable per deployment. A
  // per-account lockout is a stronger follow-up.
  const AUTH_RATE_LIMIT = {
    config: { rateLimit: { max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20), timeWindow: '1 minute' } },
  };
  // Refresh is a cheap indexed lookup of a 256-bit unguessable token, so the
  // only risk is flooding (already covered globally) — a higher cap avoids
  // throttling several devices on one IP that all refresh their 15-min access
  // token together.
  const REFRESH_RATE_LIMIT = {
    config: { rateLimit: { max: Number(process.env.REFRESH_RATE_LIMIT_MAX || 60), timeWindow: '1 minute' } },
  };

  app.post('/api/auth/register', AUTH_RATE_LIMIT, async (req, reply) => {
    const parsed = RegisterRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    const { email, password, inviteCode, accountName } = parsed.data;
    const emailLc = email.toLowerCase();

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(emailLc)) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    const open = process.env.REGISTRATION_OPEN === '1';
    let invite: { code: string; accountId: string | null; role: UserRole } | undefined;
    if (inviteCode) {
      invite = db
        .prepare('SELECT code, accountId, role FROM invites WHERE code = ? AND usedBy IS NULL AND expiresAt > ?')
        .get(inviteCode.trim().toUpperCase(), Date.now()) as typeof invite;
      if (!invite && !open) return reply.code(403).send({ error: 'Invalid or expired invite code' });
    } else if (!open) {
      return reply.code(403).send({ error: 'An invite code is required' });
    }

    let accountId = invite?.accountId ?? null;
    let role: UserRole = invite ? (accountId ? invite.role : 'admin') : 'admin';
    if (!accountId) {
      accountId = randomUUID();
      db.prepare('INSERT INTO accounts (id, name, createdAt) VALUES (?, ?, ?)').run(
        accountId,
        accountName?.trim() || emailLc.split('@')[0],
        Date.now(),
      );
    }

    const user: UserRow = {
      id: randomUUID(),
      accountId,
      email: emailLc,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      role,
    };
    db.prepare('INSERT INTO users (id, accountId, email, passwordHash, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
      user.id,
      user.accountId,
      user.email,
      user.passwordHash,
      user.role,
      Date.now(),
    );
    if (invite) db.prepare('UPDATE invites SET usedBy = ? WHERE code = ?').run(user.id, invite.code);

    bumpMetric(db, accountId, 'logins');
    return issueTokens(app, db, user);
  });

  app.post('/api/auth/login', AUTH_RATE_LIMIT, async (req, reply) => {
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const { email, password, deviceId, deviceName } = parsed.data;

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;
    // Always run a verify — against the real hash or a dummy — so an unknown
    // email takes the same time as a wrong password (no user-enumeration oracle).
    const ok = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, password).catch(() => false);
    if (!user || !ok) {
      return reply.code(401).send({ error: 'Wrong email or password' });
    }

    db.prepare('UPDATE users SET lastLoginAt = ? WHERE id = ?').run(Date.now(), user.id);
    touchDevice(db, user.accountId, user.id, deviceId, deviceName);
    bumpMetric(db, user.accountId, 'logins');
    return issueTokens(app, db, user);
  });

  app.post('/api/auth/refresh', REFRESH_RATE_LIMIT, async (req, reply) => {
    const parsed = RefreshRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });

    const hash = sha256(parsed.data.refreshToken);
    const row = db
      .prepare('SELECT id, userId FROM refresh_tokens WHERE tokenHash = ? AND expiresAt > ?')
      .get(hash, Date.now()) as { id: string; userId: string } | undefined;
    if (!row) return reply.code(401).send({ error: 'Invalid refresh token' });

    // Rotate: the old token is single-use.
    db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(row.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.userId) as UserRow | undefined;
    if (!user) return reply.code(401).send({ error: 'User no longer exists' });
    return issueTokens(app, db, user);
  });

  // Members invite helpers' devices into their account; the server owner can
  // also mint invites that create brand-new accounts (newAccount: true).
  app.post('/api/invites', { preHandler: app.authenticate }, async (req, reply) => {
    const claims = req.user as JwtClaims;
    const body = (req.body ?? {}) as { newAccount?: boolean; role?: UserRole };
    if (body.newAccount && claims.role !== 'owner') {
      return reply.code(403).send({ error: 'Only the server owner can create new-account invites' });
    }
    if (!body.newAccount && claims.role === 'member') {
      return reply.code(403).send({ error: 'Only admins can invite members' });
    }
    const code = randomBytes(4).toString('hex').toUpperCase();
    db.prepare('INSERT INTO invites (code, accountId, role, createdBy, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)').run(
      code,
      body.newAccount ? null : claims.accountId,
      body.role === 'admin' ? 'admin' : 'member',
      claims.sub,
      Date.now(),
      Date.now() + 14 * 24 * 3600 * 1000,
    );
    return { code, expiresInDays: 14 };
  });

  // ── Scoped API tokens (machine access, e.g. the ZollTax accounting bridge) ──
  // Admins/owners mint a read-only token so a config never holds a password.
  app.post('/api/tokens', { preHandler: app.authenticate }, async (req, reply) => {
    const claims = req.user as JwtClaims;
    if (claims.role === 'member') return reply.code(403).send({ error: 'Only admins or the owner can create tokens' });
    const body = (req.body ?? {}) as { name?: string; scopes?: string };
    const scopes = body.scopes?.trim() || 'data:read';
    const token = `zt_${randomBytes(24).toString('hex')}`;
    const id = randomUUID();
    db.prepare(
      'INSERT INTO api_tokens (id, accountId, name, tokenHash, scopes, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, claims.accountId, body.name?.trim() || 'API token', sha256(token), scopes, claims.sub, Date.now());
    // The plaintext token is shown exactly once — only its hash is stored.
    return { id, token, name: body.name?.trim() || 'API token', scopes };
  });

  app.get('/api/tokens', { preHandler: app.authenticate }, async (req) => {
    const claims = req.user as JwtClaims;
    return db
      .prepare(
        'SELECT id, name, scopes, createdAt, lastUsedAt, revokedAt FROM api_tokens WHERE accountId = ? ORDER BY createdAt DESC',
      )
      .all(claims.accountId);
  });

  app.delete('/api/tokens/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const claims = req.user as JwtClaims;
    if (claims.role === 'member') return reply.code(403).send({ error: 'Only admins or the owner can revoke tokens' });
    const { id } = req.params as { id: string };
    const info = db
      .prepare('UPDATE api_tokens SET revokedAt = ? WHERE id = ? AND accountId = ? AND revokedAt IS NULL')
      .run(Date.now(), id, claims.accountId);
    if (!info.changes) return reply.code(404).send({ error: 'Token not found' });
    return { revoked: true };
  });
}

/** Fastify decorator: verifies the bearer token, populates req.user with JwtClaims. */
export async function authenticate(this: FastifyInstance, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Not authenticated' });
  }
}

/**
 * Accepts EITHER a `zt_…` API token (read-only, `data:read`) OR a normal JWT.
 * Used by the read-only data API so machine clients need a scoped token, not an
 * account password. On success `req.user` is populated with JwtClaims.
 */
export async function authenticateApiOrJwt(
  this: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const m = /^Bearer\s+(zt_[A-Za-z0-9]+)$/.exec(req.headers.authorization ?? '');
  if (m) {
    const row = this.db
      .prepare('SELECT id, accountId, scopes FROM api_tokens WHERE tokenHash = ? AND revokedAt IS NULL')
      .get(sha256(m[1])) as { id: string; accountId: string; scopes: string } | undefined;
    if (!row) return reply.code(401).send({ error: 'Invalid or revoked API token' });
    const scopes = String(row.scopes || '').split(/[\s,]+/).filter(Boolean);
    if (!scopes.includes('data:read')) return reply.code(403).send({ error: 'Token lacks the data:read scope' });
    this.db.prepare('UPDATE api_tokens SET lastUsedAt = ? WHERE id = ?').run(Date.now(), row.id);
    req.user = { sub: `token:${row.id}`, accountId: row.accountId, role: 'member' } as JwtClaims;
    return;
  }
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Not authenticated' });
  }
}
