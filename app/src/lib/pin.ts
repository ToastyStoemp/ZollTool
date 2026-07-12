import { reactive } from 'vue';
import { getSetting, setSetting } from '@/db/repo';

/**
 * Optional PIN lock: helpers can sell (POS + Events stay open) but Settings,
 * Catalog, History, Customs and Admin require the PIN. This is a shop-counter
 * deterrent, not a vault — the data is on the device either way. Unlock lasts
 * for the app session (sessionStorage), so a relaunch locks again.
 */

const UNLOCK_FLAG = 'zolltool.pinUnlocked';

export const pinState = reactive({
  hash: '',
  loaded: false,
  unlocked: sessionStorage.getItem(UNLOCK_FLAG) === '1',
});

export async function loadPin(): Promise<void> {
  pinState.hash = (await getSetting<string>('security.pinHash')) ?? '';
  pinState.loaded = true;
}

export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`zolltool:${pin}`);
  // crypto.subtle needs a secure context; plain-http LAN browser use falls back
  // to a simple digest — fine for a counter deterrent.
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const byte of data) {
    h1 = Math.imul(h1 ^ byte, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + byte, 0x85ebca6b) >>> 0;
  }
  return `fnv:${h1.toString(16)}:${h2.toString(16)}`;
}

export async function tryUnlock(pin: string): Promise<boolean> {
  if (!pinState.hash) return true;
  if ((await hashPin(pin)) !== pinState.hash) return false;
  pinState.unlocked = true;
  sessionStorage.setItem(UNLOCK_FLAG, '1');
  return true;
}

/** Set (or with null: remove) the PIN. Callers verify the current PIN first. */
export async function setPin(pin: string | null): Promise<void> {
  pinState.hash = pin ? await hashPin(pin) : '';
  await setSetting('security.pinHash', pinState.hash || undefined);
  if (!pin) {
    pinState.unlocked = false;
    sessionStorage.removeItem(UNLOCK_FLAG);
  }
}
