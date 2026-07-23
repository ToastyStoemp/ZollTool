<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { X } from 'lucide-vue-next';
import type { DisplayCartMessage } from '@zolltool/shared';
import { displayCarts, syncState } from '@/sync/engine';
import { DisplayLink, Screen, hasNativePlugin } from '@/native/plugins';
import { fmtAmount, fmtPrice } from '@/lib/money';
import { loadReceiptConfig } from '@/lib/receipt';

/**
 * Customer display mode: this device mirrors another register's cart live,
 * fed by the sync server's WebSocket relay. Pick a register when several are
 * broadcasting; the newest one is followed automatically otherwise.
 */

/** How long "Thank you!" stays up if the register doesn't move on to a new sale. */
const THANKS_DISPLAY_MS = 8_000;
/** How long the idle/logo screen stays lit before the display is allowed to sleep. */
const IDLE_SCREEN_MS = 60_000;

const router = useRouter();
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;
let wakeLock: { release(): Promise<void> } | null = null;

// Branding for the idle screen — reuses the same logo/company name set up for receipts.
const logoB64 = ref('');
const companyName = ref('');

// Bluetooth channel: accept a register directly (no internet needed). Frames
// carry the same DisplayCartMessage as the WS relay and land in the same store.
const btServerActive = ref(false);
let btCartListener: { remove: () => Promise<void> } | null = null;

onMounted(async () => {
  clock = setInterval(() => (now.value = Date.now()), 5000);
  void loadReceiptConfig().then((config) => {
    logoB64.value = config.logoB64;
    companyName.value = config.artist.companyName ?? '';
  });
  if (hasNativePlugin('DisplayLink')) {
    try {
      btCartListener = await DisplayLink.addListener('displayCart', ({ json }) => {
        try {
          const msg = JSON.parse(json) as DisplayCartMessage;
          if (msg.type === 'display.cart' && msg.from && msg.cart) {
            displayCarts[msg.from] = { ...msg.cart, deviceId: msg.from, receivedAt: Date.now() };
          }
        } catch {
          /* malformed frame */
        }
      });
      await DisplayLink.startServer();
      btServerActive.value = true;
    } catch {
      /* Bluetooth off or permission denied — the WS channel still works */
    }
  }
});
onUnmounted(() => {
  if (clock) clearInterval(clock);
  if (thanksTimer) clearTimeout(thanksTimer);
  if (sleepTimer) clearTimeout(sleepTimer);
  void wakeLock?.release().catch(() => {});
  void btCartListener?.remove().catch(() => {});
  if (btServerActive.value) void DisplayLink.stopServer().catch(() => {});
});

const sources = computed(() =>
  Object.values(displayCarts).sort((a, b) => b.receivedAt - a.receivedAt),
);

const selectedId = ref('');
const current = computed(() => {
  if (selectedId.value && displayCarts[selectedId.value]) return displayCarts[selectedId.value];
  return sources.value[0] ?? null;
});

/** No update for a while — the register is gone or offline. */
const stale = computed(() => !!current.value && now.value - current.value.receivedAt > 90_000);

// "Thank you!" clears itself after THANKS_DISPLAY_MS even if the register
// never publishes a follow-up update (e.g. the cashier walks away).
const showThanksRaw = computed(() => !!current.value?.paid && !current.value.lines.length);
const thanksExpired = ref(false);
let thanksTimer: ReturnType<typeof setTimeout> | null = null;

watch(showThanksRaw, (isThanks) => {
  if (thanksTimer) {
    clearTimeout(thanksTimer);
    thanksTimer = null;
  }
  if (isThanks) {
    thanksExpired.value = false;
    thanksTimer = setTimeout(() => (thanksExpired.value = true), THANKS_DISPLAY_MS);
  }
});

const showThanks = computed(() => showThanksRaw.value && !thanksExpired.value);
const hasCartToShow = computed(() => !!current.value && current.value.lines.length > 0);

type ScreenState = 'idle' | 'thanks' | 'cart';
const screenState = computed<ScreenState>(() => {
  if (showThanks.value) return 'thanks';
  if (hasCartToShow.value) return 'cart';
  return 'idle';
});

// Screen power: wake immediately (even from locked/off) whenever there's a
// cart or a sale to show. Once idle, keep the logo screen lit for a while
// before finally letting the display sleep, rather than blanking instantly.
let sleepTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  screenState,
  async (state) => {
    if (state !== 'idle') {
      if (sleepTimer) {
        clearTimeout(sleepTimer);
        sleepTimer = null;
      }
      if (hasNativePlugin('Screen')) void Screen.wake();
      if (!wakeLock) {
        try {
          wakeLock = await (navigator as Navigator & { wakeLock?: { request(t: string): Promise<never> } }).wakeLock?.request?.('screen') ?? null;
        } catch {
          /* unsupported or denied — non-essential */
        }
      }
    } else if (!sleepTimer) {
      sleepTimer = setTimeout(() => {
        sleepTimer = null;
        void wakeLock?.release().catch(() => {});
        wakeLock = null;
      }, IDLE_SCREEN_MS);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="fixed inset-0 z-[60] flex flex-col bg-slate-950 p-8 pt-[calc(2rem_+_var(--safe-top))]">
    <!-- Discreet controls: register picker (only with several sources) + exit -->
    <div class="absolute left-3 top-[calc(0.75rem_+_var(--safe-top))] flex items-center gap-2">
      <select
        v-if="sources.length > 1"
        v-model="selectedId"
        class="rounded-lg bg-slate-900 px-2 py-1 text-xs text-slate-400"
      >
        <option value="">newest register</option>
        <option v-for="s in sources" :key="s.deviceId" :value="s.deviceId">
          {{ s.deviceName || s.deviceId }}
        </option>
      </select>
    </div>
    <button
      class="absolute right-3 top-[calc(0.75rem_+_var(--safe-top))] rounded-lg p-2 text-slate-600 hover:bg-slate-900 hover:text-slate-300"
      @click="router.push('/settings')"
    >
      <X class="h-4 w-4" />
    </button>

    <!-- Idle: no cart worth showing right now — branded logo screen -->
    <div v-if="screenState === 'idle'" class="m-auto flex flex-col items-center gap-4 text-center">
      <img
        v-if="logoB64"
        :src="`data:image/png;base64,${logoB64}`"
        class="max-h-40 max-w-[80%] rounded-lg bg-white p-3"
      />
      <p v-if="companyName" class="text-2xl font-semibold text-slate-200">{{ companyName }}</p>
      <p v-if="!syncState.enabled && !btServerActive" class="max-w-sm text-sm text-slate-500">
        Log in to the sync server under Settings, or pair this device with the register via
        Bluetooth (the register selects it under Settings → Customer display).
      </p>
      <p v-else class="animate-pulse text-sm text-slate-500">Waiting for the next sale…</p>
    </div>

    <!-- Thank-you state right after a sale -->
    <div v-else-if="screenState === 'thanks' && current" class="m-auto text-center">
      <p class="text-4xl font-bold text-emerald-400">Thank you!</p>
      <p class="mt-4 text-6xl font-bold">{{ fmtPrice(current.paid!.total, current.currency) }}</p>
    </div>

    <!-- Live cart -->
    <template v-else-if="current">
      <p class="text-center text-lg text-slate-400">
        {{ current.eventName }}
        <span v-if="stale" class="ml-2 rounded bg-amber-950 px-2 py-0.5 text-xs text-amber-400">register offline?</span>
      </p>
      <div class="mx-auto mt-6 w-full max-w-2xl flex-1 space-y-3 overflow-y-auto">
        <div v-for="(l, i) in current.lines" :key="i" class="flex justify-between text-2xl">
          <span class="min-w-0 truncate">
            {{ l.qty }} × {{ l.title }}<span v-if="l.variantLabel" class="text-slate-400"> · {{ l.variantLabel }}</span>
          </span>
          <span class="shrink-0 pl-4 font-semibold">{{ fmtPrice(l.lineTotal, current.currency) }}</span>
        </div>
        <div v-for="d in current.discounts" :key="d.name" class="flex justify-between text-2xl text-emerald-400">
          <span>{{ d.name }}</span><span>− {{ fmtPrice(d.amount, current.currency) }}</span>
        </div>
      </div>
      <div class="mx-auto w-full max-w-2xl border-t border-slate-700 pt-5">
        <p class="text-xl text-slate-400">Total</p>
        <p class="mt-1 flex items-baseline justify-end gap-2">
          <span class="text-2xl font-semibold text-emerald-400/70">{{ current.currency }}</span>
          <span class="text-7xl font-bold tabular-nums text-emerald-400">{{ fmtAmount(current.total) }}</span>
        </p>
      </div>
    </template>
  </div>
</template>
