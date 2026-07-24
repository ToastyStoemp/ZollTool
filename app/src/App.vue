<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CalendarDays, ChartLine, Lock, Package, Settings } from 'lucide-vue-next';
import { showToast, toasts } from '@/lib/toast';
import { loadPin, pinState, tryUnlock } from '@/lib/pin';
import { useSettingsStore } from '@/stores/settings';
import { syncState } from '@/sync/engine';
import { isNative } from '@/native/plugins';
import { checkForUpdate, currentFlavor, downloadUpdate, updateDownload } from '@/lib/updates';
import OnboardingWizard from '@/components/OnboardingWizard.vue';
import WebAuthGate from '@/components/WebAuthGate.vue';

const route = useRoute();
const settings = useSettingsStore();

// The web build is served publicly from the sync server's own domain, so
// anyone who finds the URL could otherwise use the full offline-capable POS
// with no account. The Android app stays offline-first, unaffected.
const showWebAuthGate = computed(() => !isNative && settings.ready && !settings.syncUser);

// At-a-glance sync health: amber = changes waiting, red = last sync failed.
const syncBadge = computed<null | { cls: string; title: string }>(() => {
  if (!settings.syncUser) return null;
  if (syncState.lastError) return { cls: 'bg-red-500', title: `Sync offline — ${syncState.lastError}` };
  if (syncState.pendingOps > 0) {
    return { cls: 'bg-amber-400', title: `${syncState.pendingOps} change(s) waiting to sync` };
  }
  return null;
});

// Selling and customs are reached through an event (Events tab) so it's
// always clear which event they apply to.
const nav = [
  { to: '/events', label: 'Events', icon: CalendarDays },
  { to: '/catalog', label: 'Catalog', icon: Package },
  { to: '/history', label: 'History', icon: ChartLine },
  { to: '/settings', label: 'Settings', icon: Settings },
];

// POS is a focused fullscreen mode: hide the app nav so the whole screen
// (especially tablets in landscape) is selling surface. The POS header has
// its own back/history shortcuts.
const chromeHidden = computed(() => route.name === 'pos' || route.name === 'display');

// ── PIN lock: selling stays open, management areas need the PIN ────────────
const router = useRouter();
const PIN_PROTECTED = ['/settings', '/catalog', '/history', '/admin', '/customs'];
const pinPromptVisible = computed(
  () =>
    pinState.loaded &&
    !!pinState.hash &&
    !pinState.unlocked &&
    PIN_PROTECTED.some((p) => route.path.startsWith(p)),
);
const pinInput = ref('');
const pinError = ref(false);

onMounted(() => {
  void loadPin();
  void autoUpdateCheck();
});

/**
 * Auto-update: compat and carbon, not full — those are the devices least
 * likely to have anyone regularly opening Settings to check by hand (a
 * tablet nobody babysits, or a payment terminal with no easy USB/ADB path
 * for manual sideloading). Downloads in the background and stops there —
 * installing still needs the user's explicit tap (Settings → App updates),
 * since the system's "install unknown app" consent dialog and the intent
 * taking over the screen would be disruptive mid-sale on a device actively
 * used for a live transaction.
 */
async function autoUpdateCheck(): Promise<void> {
  if (!isNative || !['compat', 'carbon'].includes(currentFlavor() ?? '')) return;
  try {
    const check = await checkForUpdate(settings.serverUrl);
    if (check?.available) {
      await downloadUpdate(check);
      if (updateDownload.ready) {
        showToast(`Update ${check.versionName} ready — install from Settings`, 'info');
      }
    }
  } catch {
    /* silent — background convenience check, not a user-initiated action */
  }
}

async function submitPin(): Promise<void> {
  if (await tryUnlock(pinInput.value)) {
    pinError.value = false;
  } else {
    pinError.value = true;
  }
  pinInput.value = '';
}
</script>

<template>
  <div class="app-shell flex flex-col md:flex-row md:pb-[var(--safe-bottom)]">
    <!-- Sidebar (tablet/desktop) -->
    <aside v-if="!chromeHidden" class="hidden w-52 shrink-0 flex-col border-r border-slate-800 bg-slate-900 md:flex">
      <div class="flex items-center gap-2 px-4 py-5">
        <span class="text-xl font-bold tracking-tight text-emerald-400">ZollTool</span>
        <span v-if="syncBadge" class="h-2 w-2 rounded-full" :class="syncBadge.cls" :title="syncBadge.title" />
      </div>
      <nav class="flex flex-1 flex-col gap-1 px-2">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800"
          :class="{ 'bg-slate-800 text-emerald-400': route.path.startsWith(item.to) }"
        >
          <component :is="item.icon" class="h-4.5 w-4.5" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
    </aside>

    <!-- Main content -->
    <main class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <RouterView />
    </main>

    <!-- Bottom nav (phone) — bottom padding keeps it above the gesture bar -->
    <nav v-if="!chromeHidden" class="flex shrink-0 border-t border-slate-800 bg-slate-900 pb-[var(--safe-bottom)] md:hidden">
      <RouterLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-slate-400"
        :class="{ 'text-emerald-400': route.path.startsWith(item.to) }"
      >
        <span class="relative">
          <component :is="item.icon" class="h-5 w-5" />
          <span
            v-if="syncBadge && item.to === '/settings'"
            class="absolute -right-1 -top-0.5 h-2 w-2 rounded-full"
            :class="syncBadge.cls"
          />
        </span>
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <!-- PIN lock: covers the management views until unlocked -->
    <div
      v-if="pinPromptVisible"
      class="fixed inset-0 z-[65] flex flex-col items-center justify-center gap-4 bg-slate-950/95 p-6 backdrop-blur-sm"
    >
      <Lock class="h-8 w-8 text-slate-500" />
      <p class="text-sm text-slate-300">This area is PIN-protected</p>
      <form class="flex w-full max-w-56 flex-col gap-2" @submit.prevent="submitPin">
        <input
          v-model="pinInput"
          type="password"
          inputmode="numeric"
          autocomplete="off"
          placeholder="PIN"
          class="w-full rounded-lg bg-slate-800 px-3 py-2 text-center text-lg tracking-[0.4em]"
        />
        <p v-if="pinError" class="text-center text-xs text-red-400">Wrong PIN</p>
        <button type="submit" class="rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white">
          Unlock
        </button>
        <button
          type="button"
          class="rounded-lg py-2 text-xs text-slate-400 hover:text-slate-200"
          @click="router.push('/events')"
        >
          Back to selling
        </button>
      </form>
    </div>

    <!-- Web login gate: browser access only, above everything else -->
    <WebAuthGate v-if="showWebAuthGate" />

    <!-- First-run setup guide -->
    <OnboardingWizard v-if="settings.ready && !settings.onboardingDone" />

    <!-- Toasts -->
    <div class="pointer-events-none fixed inset-x-0 top-[calc(0.75rem_+_var(--safe-top))] z-[60] flex flex-col items-center gap-2">
      <TransitionGroup name="toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="rounded-lg px-4 py-2 text-sm font-medium shadow-lg ring-1"
          :class="{
            'bg-emerald-950 text-emerald-300 ring-emerald-700': t.kind === 'success',
            'bg-red-950 text-red-300 ring-red-700': t.kind === 'error',
            'bg-slate-800 text-slate-200 ring-slate-600': t.kind === 'info',
          }"
        >
          {{ t.message }}
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
