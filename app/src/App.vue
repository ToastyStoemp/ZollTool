<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { CalendarDays, ChartLine, Package, Settings } from 'lucide-vue-next';
import { toasts } from '@/lib/toast';
import { useSettingsStore } from '@/stores/settings';
import { syncState } from '@/sync/engine';
import OnboardingWizard from '@/components/OnboardingWizard.vue';

const route = useRoute();
const settings = useSettingsStore();

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
const chromeHidden = computed(() => route.name === 'pos');
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
