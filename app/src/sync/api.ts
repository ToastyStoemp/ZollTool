import type {
  AuthUser,
  DeviceSummary,
  PullResponse,
  PushRequest,
  PushResponse,
  TokenResponse,
} from '@zolltool/shared';
import { getSetting, setSetting } from '@/db/repo';
import { db } from '@/db/schema';
import { currentFlavor } from '@/lib/updates';
import { solveChallenge } from '@/lib/captcha';

/** Cloud API client: token storage, transparent refresh, typed endpoints. */

export const SYNC_KEYS = {
  serverUrl: 'sync.serverUrl',
  accessToken: 'sync.accessToken',
  refreshToken: 'sync.refreshToken',
  user: 'sync.user',
  lastServerSeq: 'sync.lastServerSeq',
  deviceTrust: 'sync.deviceTrust', // per-device 2FA trust token (skip code on this device)
} as const;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Thrown by login() when the account has 2FA on and no valid code/trust was given. */
export class TwoFactorRequired extends Error {
  constructor(public invalidCode = false) {
    super('Two-factor code required');
  }
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export async function getServerUrl(): Promise<string | undefined> {
  return getSetting<string>(SYNC_KEYS.serverUrl);
}

export async function getSyncUser(): Promise<AuthUser | undefined> {
  return getSetting<AuthUser>(SYNC_KEYS.user);
}

export async function isLoggedIn(): Promise<boolean> {
  return !!(await getSetting<string>(SYNC_KEYS.refreshToken));
}

async function storeSession(serverUrl: string, tokens: TokenResponse): Promise<void> {
  await setSetting(SYNC_KEYS.serverUrl, normalizeUrl(serverUrl));
  await setSetting(SYNC_KEYS.accessToken, tokens.accessToken);
  await setSetting(SYNC_KEYS.refreshToken, tokens.refreshToken);
  await setSetting(SYNC_KEYS.user, tokens.user);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

type LoginResponse = TokenResponse & { needs2fa?: boolean; deviceTrustToken?: string };

/**
 * Log in. If the account has 2FA, pass `code` (authenticator or recovery). On
 * the first successful 2FA login pass `rememberDevice` to trust this device so
 * future logins skip the code. Throws TwoFactorRequired when a code is needed.
 */
export async function login(
  serverUrl: string,
  email: string,
  password: string,
  opts: { code?: string; rememberDevice?: boolean } = {},
): Promise<AuthUser> {
  const base = normalizeUrl(serverUrl);
  const deviceId = await getSetting<string>('deviceId');
  const deviceName = await getSetting<string>('deviceName');
  const trustToken = deviceId ? await getSetting<string>(SYNC_KEYS.deviceTrust) : undefined;
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      deviceId,
      deviceName,
      flavor: currentFlavor() ?? 'web',
      trustToken,
      code: opts.code,
      rememberDevice: opts.rememberDevice,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as LoginResponse & { error?: string; needs2fa?: boolean };
  if (!res.ok) {
    if (res.status === 401 && data.needs2fa) throw new TwoFactorRequired(!!opts.code);
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  }
  await storeSession(base, data);
  if (data.deviceTrustToken) await setSetting(SYNC_KEYS.deviceTrust, data.deviceTrustToken);
  return data.user;
}

export async function registerAccount(
  serverUrl: string,
  req: { email: string; password: string; inviteCode?: string; accountName?: string },
): Promise<AuthUser> {
  const base = normalizeUrl(serverUrl);
  // Solve the proof-of-work CAPTCHA (no-op server-side if REQUIRE_CAPTCHA=0).
  let captcha: { captchaToken?: string; captchaSolution?: string } = {};
  try {
    const ch = await postJsonGet<{ token: string; nonce: string; difficulty: number }>(`${base}/api/captcha/challenge`);
    captcha = { captchaToken: ch.token, captchaSolution: solveChallenge(ch.nonce, ch.difficulty) };
  } catch {
    /* challenge endpoint unreachable — server will reject if it requires one */
  }
  const deviceId = await getSetting<string>('deviceId');
  const deviceName = await getSetting<string>('deviceName');
  const tokens = await postJson<TokenResponse>(`${base}/api/auth/register`, {
    ...req,
    deviceId,
    deviceName,
    flavor: currentFlavor() ?? 'web',
    ...captcha,
  });
  await storeSession(base, tokens);
  return tokens.user;
}

async function postJsonGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

export async function logout(): Promise<void> {
  await setSetting(SYNC_KEYS.accessToken, undefined);
  await setSetting(SYNC_KEYS.refreshToken, undefined);
  await setSetting(SYNC_KEYS.user, undefined);
}

/** Full local logout also forgets sync progress (fresh pull after next login). */
export async function forgetSyncProgress(): Promise<void> {
  await setSetting(SYNC_KEYS.lastServerSeq, 0);
  await db.ops.where('synced').equals(1).delete();
}

async function refreshAccessToken(base: string): Promise<boolean> {
  const refreshToken = await getSetting<string>(SYNC_KEYS.refreshToken);
  if (!refreshToken) return false;
  try {
    const tokens = await postJson<TokenResponse>(`${base}/api/auth/refresh`, { refreshToken });
    await storeSession(base, tokens);
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) await logout();
    return false;
  }
}

/** Authenticated fetch with a single transparent token refresh on 401. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = await getServerUrl();
  if (!base) throw new ApiError('No server configured', 0);

  const doFetch = async (): Promise<Response> => {
    const accessToken = await getSetting<string>(SYNC_KEYS.accessToken);
    return fetch(`${base}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${accessToken}` },
    });
  };

  let res = await doFetch();
  if (res.status === 401 && (await refreshAccessToken(base))) {
    res = await doFetch();
  }
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

export function pushOps(req: PushRequest): Promise<PushResponse> {
  return apiJson<PushResponse>('/api/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function pullOps(since: number): Promise<PullResponse> {
  return apiJson<PullResponse>(`/api/sync/pull?since=${since}`);
}

/** Devices this account has seen — backs pickers like "which Carbon to target". */
export function listDevices(): Promise<DeviceSummary[]> {
  return apiJson<DeviceSummary[]>('/api/devices');
}

/** A scoped read-only API token as returned by the list endpoint (no secret). */
export interface ApiTokenSummary {
  id: string;
  name: string;
  scopes: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** Freshly minted token — `token` is the plaintext `zt_…`, shown exactly once. */
export interface MintedApiToken {
  id: string;
  token: string;
  name: string;
  scopes: string;
}

/** Read-only API tokens for the account, newest first (owner/admin only). */
export function listApiTokens(): Promise<ApiTokenSummary[]> {
  return apiJson<ApiTokenSummary[]>('/api/tokens');
}

/** Mint a scoped read-only token. The plaintext is returned once — store it now. */
export function createApiToken(name?: string): Promise<MintedApiToken> {
  return apiJson<MintedApiToken>('/api/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

/** Revoke a token by id — it stops authenticating immediately. */
export function revokeApiToken(id: string): Promise<{ revoked: boolean }> {
  return apiJson<{ revoked: boolean }>(`/api/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Two-factor auth ──────────────────────────────────────────────────────────
export interface TotpSetup {
  secret: string;
  otpauth: string;
}
const jsonPost = (body?: unknown): RequestInit =>
  body === undefined
    ? { method: 'POST' } // no content-type: an empty JSON body would be a 400
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };

export function get2faStatus(): Promise<{ enabled: boolean }> {
  return apiJson('/api/2fa/status');
}
export function setup2fa(): Promise<TotpSetup> {
  return apiJson('/api/2fa/setup', jsonPost());
}
export function enable2fa(code: string): Promise<{ enabled: boolean; recovery: string[] }> {
  return apiJson('/api/2fa/enable', jsonPost({ code }));
}
export function disable2fa(code: string): Promise<{ enabled: boolean }> {
  return apiJson('/api/2fa/disable', jsonPost({ code }));
}

// ── Login sessions ───────────────────────────────────────────────────────────
export interface SessionInfo {
  id: string;
  deviceId?: string;
  deviceName?: string;
  device?: string;
  ip?: string;
  geo?: string;
  flavor?: string;
  createdAt: number;
  lastUsedAt: number;
}
export interface AdminSessionInfo extends SessionInfo {
  userId: string;
  email: string;
  role: string;
  accountName: string;
}

export function listSessions(): Promise<{ geo: boolean; sessions: SessionInfo[] }> {
  return apiJson('/api/sessions');
}
export function revokeSession(id: string): Promise<{ ok: boolean }> {
  return apiJson(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
/** Log out everywhere except this device. */
export async function revokeOtherSessions(): Promise<{ revoked: number }> {
  const deviceId = await getSetting<string>('deviceId');
  return apiJson('/api/sessions/revoke-others', jsonPost({ deviceId }));
}
export function listAdminSessions(): Promise<{ geo: boolean; sessions: AdminSessionInfo[] }> {
  return apiJson('/api/admin/sessions');
}
export function revokeAdminSession(id: string): Promise<{ ok: boolean }> {
  return apiJson(`/api/admin/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** This device's id — lets the sessions UI mark "this device". */
export function getDeviceId(): Promise<string | undefined> {
  return getSetting<string>('deviceId');
}

export async function uploadImage(id: string, blob: Blob): Promise<void> {
  const res = await apiFetch(`/api/images/${id}`, {
    method: 'PUT',
    headers: { 'content-type': blob.type || 'image/jpeg' },
    body: blob,
  });
  if (!res.ok) throw new ApiError(`Image upload failed (${res.status})`, res.status);
}

export async function fetchImage(id: string): Promise<Blob | null> {
  const res = await apiFetch(`/api/images/${id}`);
  if (!res.ok) return null;
  return res.blob();
}
