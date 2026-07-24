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

/** Cloud API client: token storage, transparent refresh, typed endpoints. */

export const SYNC_KEYS = {
  serverUrl: 'sync.serverUrl',
  accessToken: 'sync.accessToken',
  refreshToken: 'sync.refreshToken',
  user: 'sync.user',
  lastServerSeq: 'sync.lastServerSeq',
} as const;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
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

export async function login(serverUrl: string, email: string, password: string): Promise<AuthUser> {
  const base = normalizeUrl(serverUrl);
  const deviceId = await getSetting<string>('deviceId');
  const deviceName = await getSetting<string>('deviceName');
  const tokens = await postJson<TokenResponse>(`${base}/api/auth/login`, { email, password, deviceId, deviceName });
  await storeSession(base, tokens);
  return tokens.user;
}

export async function registerAccount(
  serverUrl: string,
  req: { email: string; password: string; inviteCode?: string; accountName?: string },
): Promise<AuthUser> {
  const base = normalizeUrl(serverUrl);
  const tokens = await postJson<TokenResponse>(`${base}/api/auth/register`, req);
  await storeSession(base, tokens);
  return tokens.user;
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
