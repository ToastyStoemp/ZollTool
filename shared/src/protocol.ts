import { z } from 'zod';

/** Wire protocol between app and sync server — validated with zod on both sides. */

export const OpTypeSchema = z.enum([
  'tx.create',
  'tx.revert',
  'product.upsert',
  'product.delete',
  'event.upsert',
  'event.close',
  'stock.set',
  'discount.upsert',
  'discount.delete',
  'image.meta',
]);

export const OpSchema = z.object({
  opId: z.string().min(16),
  deviceId: z.string().min(1),
  ts: z.number(),
  type: OpTypeSchema,
  payload: z.unknown(),
});
export type WireOp = z.infer<typeof OpSchema>;

/** An op as stored/fanned out by the server: ordered per account. */
export const ServerOpSchema = OpSchema.extend({
  serverSeq: z.number(),
});
export type ServerOp = z.infer<typeof ServerOpSchema>;

// ── Sync ─────────────────────────────────────────────────────────────────────

export const PushRequestSchema = z.object({
  deviceId: z.string().min(1),
  deviceName: z.string().optional(),
  ops: z.array(OpSchema).max(500),
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export interface PushResponse {
  accepted: number;
  duplicates: number;
  latestSeq: number;
}

export interface PullResponse {
  ops: ServerOp[];
  latestSeq: number;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  /** Required unless the server runs with REGISTRATION_OPEN=1. */
  inviteCode: z.string().optional(),
  /** Name for the new account (ignored when the invite joins an existing one). */
  accountName: z.string().min(1).optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceId: z.string().optional(),
  deviceName: z.string().optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(16),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export type UserRole = 'owner' | 'admin' | 'member';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  accountId: string;
  accountName: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

/** WS doorbell message — tells clients to pull over HTTP; carries no data itself. */
export interface NudgeMessage {
  type: 'nudge';
  latestSeq: number;
}

// ── Customer display (ephemeral cart relay over the sync WS) ────────────────

/** Self-contained cart snapshot a register broadcasts for customer displays. */
export interface DisplayCart {
  deviceName: string;
  eventName: string;
  currency: string;
  lines: Array<{ title: string; variantLabel?: string; qty: number; lineTotal: number }>;
  discounts: Array<{ name: string; amount: number }>;
  total: number;
  /** Set right after a completed sale — displays show a thank-you state. */
  paid?: { total: number };
  ts: number;
}

/**
 * Sent register → server (no `from`), rebroadcast server → account room with
 * `from` = the register's deviceId. Never persisted.
 */
export interface DisplayCartMessage {
  type: 'display.cart';
  from?: string;
  cart: DisplayCart;
}

// ── Admin (owner-only) ───────────────────────────────────────────────────────

export interface AdminOverview {
  accounts: number;
  users: number;
  devices: number;
  ops: number;
  transactions: number;
  activeToday: number;
}

export interface AdminAccount {
  id: string;
  name: string;
  createdAt: number;
  userCount: number;
  deviceCount: number;
  opCount: number;
  txTotal: number;
  /** Most recent op received or device seen, whichever is later (0 = never). */
  lastActivityAt: number;
}

export interface AdminAccountDetail {
  account: AdminAccount;
  users: { id: string; email: string; role: UserRole; createdAt: number; lastLoginAt: number | null }[];
  devices: { id: string; name: string | null; createdAt: number; lastSeenAt: number }[];
}

export interface AdminMetricRow {
  accountId: string;
  accountName: string;
  day: string;
  logins: number;
  syncPushes: number;
  opsReceived: number;
  txCount: number;
}
