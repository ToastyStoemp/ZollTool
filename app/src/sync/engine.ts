import { reactive } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import type {
  DisplayCart,
  DisplayCartMessage,
  NudgeMessage,
  Op,
  PaymentResultMessage,
  PaymentTriggerMessage,
} from '@zolltool/shared';
import { db } from '@/db/schema';
import { getSetting, setSetting } from '@/db/repo';
import { SYNC_KEYS, fetchImage, getServerUrl, isLoggedIn, pullOps, pushOps, uploadImage } from './api';
import { applyRemoteOps } from './apply';
import { currentFlavor } from '@/lib/updates';
import { isNative } from '@/native/plugins';

/** 'carbon' | 'compat' | 'full' | 'web' — lets other devices find e.g. a Carbon terminal to target. */
function deviceFlavor(): string | undefined {
  return currentFlavor() ?? (isNative ? undefined : 'web');
}

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

// ── Customer display relay (ephemeral, rides the sync WS) ───────────────────

/** Latest cart snapshot per register deviceId, as received from the server. */
export const displayCarts = reactive<Record<string, DisplayCart & { deviceId: string; receivedAt: number }>>({});

/** Broadcast this register's cart to the account's customer displays. */
export function sendDisplayCart(cart: DisplayCart): void {
  if (ws?.readyState === WebSocket.OPEN) {
    const msg: DisplayCartMessage = { type: 'display.cart', cart };
    ws.send(JSON.stringify(msg));
  }
}

// ── Remote payment trigger (point-to-point, unlike the broadcast cart relay) ─

type PaymentMessage = PaymentTriggerMessage | PaymentResultMessage;
const paymentListeners = new Set<(msg: PaymentMessage) => void>();

/** Subscribe to incoming payment.trigger/payment.result frames over the sync WS. Returns an unsubscribe fn. */
export function onPaymentMessage(cb: (msg: PaymentMessage) => void): () => void {
  paymentListeners.add(cb);
  return () => paymentListeners.delete(cb);
}

function emitPaymentMessage(msg: PaymentMessage): void {
  for (const cb of paymentListeners) cb(msg);
}

/** Send a payment trigger/result over WS if connected — callers also send over Bluetooth (DisplayLink) as a fallback. */
export function sendPaymentMessage(msg: PaymentMessage): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

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
  // Await the first round so callers (login, setup guide) continue with the
  // account's data already pulled.
  await syncNow();
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
    await pushOps({ deviceId, deviceName, flavor: deviceFlavor(), ops });
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

    const flavor = deviceFlavor();
    const url =
      `${base.replace(/^http/, 'ws')}/api/sync/ws?token=${encodeURIComponent(token)}&deviceId=${deviceId}` +
      (flavor ? `&flavor=${encodeURIComponent(flavor)}` : '');
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
        const msg = JSON.parse(String(ev.data)) as NudgeMessage | DisplayCartMessage | PaymentMessage;
        if (msg.type === 'nudge') void syncNow();
        else if (msg.type === 'display.cart' && msg.from && msg.cart) {
          displayCarts[msg.from] = { ...msg.cart, deviceId: msg.from, receivedAt: Date.now() };
        } else if (msg.type === 'payment.trigger' || msg.type === 'payment.result') {
          emitPaymentMessage(msg);
        }
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
