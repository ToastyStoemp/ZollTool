import { reactive } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import type { NudgeMessage, Op } from '@zolltool/shared';
import { db } from '@/db/schema';
import { getSetting, setSetting } from '@/db/repo';
import { SYNC_KEYS, fetchImage, getServerUrl, isLoggedIn, pullOps, pushOps, uploadImage } from './api';
import { applyRemoteOps } from './apply';

/**
 * Sync engine: push the outbox, pull what's new, repeat.
 * Triggers: a new local op (debounced), a WS nudge, coming back online,
 * and a 30s poll as the catch-all. Everything is safe to retry.
 */

export const syncState = reactive({
  enabled: false,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  wsConnected: false,
  syncing: false,
  pendingOps: 0,
  lastSyncAt: 0,
  lastError: '',
});

const PUSH_BATCH = 200;
const POLL_MS = 30_000;
const WS_RETRY_MS = 5_000;

let ws: WebSocket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
let pushDebounce: ReturnType<typeof setTimeout> | null = null;
let outboxSub: Subscription | null = null;
let syncing = false;

export async function startSync(): Promise<void> {
  if (syncState.enabled) return;
  if (!(await getServerUrl()) || !(await isLoggedIn())) return;
  syncState.enabled = true;
  syncState.lastError = '';

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  outboxSub = liveQuery(() => db.ops.where('synced').equals(0).count()).subscribe({
    next: (count) => {
      syncState.pendingOps = count;
      if (count > 0 && syncState.online) schedulePush();
    },
  });

  pollTimer = setInterval(() => void syncNow(), POLL_MS);
  connectWs();
  void syncNow();
}

export function stopSync(): void {
  syncState.enabled = false;
  syncState.wsConnected = false;
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
  outboxSub?.unsubscribe();
  outboxSub = null;
  if (pollTimer) clearInterval(pollTimer);
  if (wsRetryTimer) clearTimeout(wsRetryTimer);
  if (pushDebounce) clearTimeout(pushDebounce);
  pollTimer = wsRetryTimer = pushDebounce = null;
  ws?.close();
  ws = null;
}

function onOnline(): void {
  syncState.online = true;
  connectWs();
  void syncNow();
}

function onOffline(): void {
  syncState.online = false;
  syncState.wsConnected = false;
}

function schedulePush(): void {
  if (pushDebounce) return;
  pushDebounce = setTimeout(() => {
    pushDebounce = null;
    void syncNow();
  }, 800);
}

export async function syncNow(): Promise<void> {
  if (!syncState.enabled || !syncState.online || syncing) return;
  syncing = true;
  syncState.syncing = true;
  try {
    await pushOutbox();
    await pullAll();
    syncState.lastSyncAt = Date.now();
    syncState.lastError = '';
  } catch (err) {
    syncState.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    syncing = false;
    syncState.syncing = false;
  }
}

async function pushOutbox(): Promise<void> {
  const deviceId = (await getSetting<string>('deviceId')) ?? 'unknown-device';
  const deviceName = await getSetting<string>('deviceName');

  for (;;) {
    const batch = await db.ops.where('synced').equals(0).limit(PUSH_BATCH).toArray();
    if (!batch.length) break;

    const ops: Op[] = batch.map(({ opId, deviceId: d, ts, type, payload }) => ({ opId, deviceId: d, ts, type, payload }));
    await pushOps({ deviceId, deviceName, ops });
    await db.ops
      .where('seq')
      .anyOf(batch.map((o) => o.seq!))
      .modify({ synced: 1 });

    // Full-size images ride outside the op stream — upload after their meta op.
    for (const op of batch) {
      if (op.type !== 'image.meta') continue;
      const { imageId } = op.payload as { imageId: string };
      const rec = await db.images.get(imageId);
      if (rec) {
        try {
          await uploadImage(imageId, rec.full);
        } catch {
          // Non-fatal: other devices fall back to the inline thumbnail.
        }
      }
    }
    if (batch.length < PUSH_BATCH) break;
  }
}

async function pullAll(): Promise<void> {
  const deviceId = (await getSetting<string>('deviceId')) ?? 'unknown-device';
  let since = (await getSetting<number>(SYNC_KEYS.lastServerSeq)) ?? 0;

  for (;;) {
    const { ops, latestSeq } = await pullOps(since);
    if (!ops.length) {
      if (latestSeq > since) await setSetting(SYNC_KEYS.lastServerSeq, latestSeq);
      break;
    }
    const wantFull = await applyRemoteOps(ops, deviceId);
    since = ops[ops.length - 1].serverSeq;
    await setSetting(SYNC_KEYS.lastServerSeq, since);
    void fetchFullImages(wantFull);
    if (since >= latestSeq) break;
  }
}

/** Replace thumbnail placeholders with the real full-size images, best effort. */
async function fetchFullImages(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      const blob = await fetchImage(id);
      if (blob) await db.images.update(id, { full: blob });
    } catch {
      /* keep the thumb placeholder */
    }
  }
}

function connectWs(): void {
  if (!syncState.enabled || ws) return;
  void (async () => {
    const base = await getServerUrl();
    const token = await getSetting<string>(SYNC_KEYS.accessToken);
    const deviceId = await getSetting<string>('deviceId');
    if (!base || !token || !syncState.enabled) return;

    const url = `${base.replace(/^http/, 'ws')}/api/sync/ws?token=${encodeURIComponent(token)}&deviceId=${deviceId}`;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleWsRetry();
      return;
    }
    ws.onopen = () => {
      syncState.wsConnected = true;
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as NudgeMessage;
        if (msg.type === 'nudge') void syncNow();
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      syncState.wsConnected = false;
      ws = null;
      scheduleWsRetry();
    };
    ws.onerror = () => ws?.close();
  })();
}

function scheduleWsRetry(): void {
  if (!syncState.enabled || wsRetryTimer) return;
  wsRetryTimer = setTimeout(() => {
    wsRetryTimer = null;
    if (syncState.online) connectWs();
  }, WS_RETRY_MS);
}
