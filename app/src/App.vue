<script setup lang="ts">
import { useRoute } from 'vue-router';
import { toasts } from '@/lib/toast';
import { useSettingsStore } from '@/stores/settings';
import OnboardingWizard from '@/components/OnboardingWizard.vue';

const route = useRoute();
const settings = useSettingsStore();

// Selling and customs are reached through an event (Events tab) so it's
// always clear which event they apply to.
const nav = [
  { to: '/events', label: 'Events', icon: '📅' },
  { to: '/catalog', label: 'Catalog', icon: '📦' },
  { to: '/history', label: 'History', icon: '📈' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];
</script>

<template>
  <div class="app-shell flex flex-col md:flex-row md:pb-[var(--safe-bottom)]">
    <!-- Sidebar (tablet/desktop) -->
    <aside class="hidden w-52 shrink-0 flex-col border-r border-slate-800 bg-slate-900 md:flex">
      <div class="flex items-center gap-2 px-4 py-5">
        <span class="text-xl font-bold tracking-tight text-emerald-400">ZollTool</span>
      </div>
      <nav class="flex flex-1 flex-col gap-1 px-2">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800"
          :class="{ 'bg-slate-800 text-emerald-400': route.path.startsWith(item.to) }"
        >
          <span>{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
    </aside>

    <!-- Main content -->
    <main class="min-h-0 flex-1 overflow-y-auto">
      <RouterView />
    </main>

    <!-- Bottom nav (phone) — bottom padding keeps it above the gesture bar -->
    <nav class="flex shrink-0 border-t border-slate-800 bg-slate-900 pb-[var(--safe-bottom)] md:hidden">
      <RouterLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-slate-400"
        :class="{ 'text-emerald-400': route.path.startsWith(item.to) }"
      >
        <span class="text-lg leading-none">{{ item.icon }}</span>
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
