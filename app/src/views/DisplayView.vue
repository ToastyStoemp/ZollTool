<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { X } from 'lucide-vue-next';
import { displayCarts, syncState } from '@/sync/engine';
import { fmtPrice } from '@/lib/money';

/**
 * Customer display mode: this device mirrors another register's cart live,
 * fed by the sync server's WebSocket relay. Pick a register when several are
 * broadcasting; the newest one is followed automatically otherwise.
 */

const router = useRouter();
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;
let wakeLock: { release(): Promise<void> } | null = null;

onMounted(async () => {
  clock = setInterval(() => (now.value = Date.now()), 5000);
  // Keep the screen on where supported (Android WebView 84+, desktop browsers)
  try {
    wakeLock = await (navigator as Navigator & { wakeLock?: { request(t: string): Promise<never> } }).wakeLock?.request?.('screen') ?? null;
  } catch {
    /* unsupported or denied — non-essential */
  }
});
onUnmounted(() => {
  if (clock) clearInterval(clock);
  void wakeLock?.release().catch(() => {});
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
const showThanks = computed(
  () => !!current.value?.paid && !current.value.lines.length,
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

    <!-- Waiting states -->
    <div v-if="!syncState.enabled" class="m-auto max-w-sm text-center text-slate-400">
      <p class="text-xl font-semibold">Not connected</p>
      <p class="mt-2 text-sm">Log in to the sync server under Settings first — the display mirrors a register through it.</p>
    </div>
    <div v-else-if="!current" class="m-auto text-center text-slate-500">
      <p class="text-2xl font-semibold">Welcome!</p>
      <p class="mt-2 animate-pulse text-sm">Waiting for a register…</p>
    </div>

    <!-- Thank-you state right after a sale -->
    <div v-else-if="showThanks" class="m-auto text-center">
      <p class="text-4xl font-bold text-emerald-400">Thank you!</p>
      <p class="mt-4 text-6xl font-bold">{{ fmtPrice(current.paid!.total, current.currency) }}</p>
    </div>

    <!-- Live cart -->
    <template v-else>
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
        <p v-if="!current.lines.length" class="pt-16 text-center text-3xl text-slate-500">Welcome!</p>
      </div>
      <div class="mx-auto w-full max-w-2xl border-t border-slate-700 pt-5">
        <div class="flex items-baseline justify-between">
          <span class="text-3xl text-slate-300">Total</span>
          <span class="text-7xl font-bold text-emerald-400">{{ fmtPrice(current.total, current.currency) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
