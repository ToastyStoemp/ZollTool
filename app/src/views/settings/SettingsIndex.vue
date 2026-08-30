<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ChevronRight, Smartphone, CreditCard, Receipt, ShieldCheck, Package } from 'lucide-vue-next';
import { Updater, hasNativePlugin } from '@/native/plugins';

const appVersion = ref(__APP_VERSION__);
onMounted(async () => {
  if (hasNativePlugin('Updater')) {
    try {
      appVersion.value = (await Updater.getCurrentVersion()).versionName;
    } catch {
      /* keep the build-time stamp */
    }
  }
});

const pages = [
  { to: '/settings/device', label: 'Device', desc: 'Name, currency, rounding, customer display', icon: Smartphone },
  { to: '/settings/payments', label: 'Payments', desc: 'Card terminal & extra payment methods', icon: CreditCard },
  { to: '/settings/receipts', label: 'Artist & receipts', desc: 'Business details, logo, printer', icon: Receipt },
  { to: '/settings/account', label: 'Account & security', desc: 'Server sync, 2FA, sessions, PIN lock', icon: ShieldCheck },
  { to: '/settings/app', label: 'App & data', desc: 'Updates, backup, legacy app', icon: Package },
];
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 md:p-6">
    <div class="mb-6 flex items-baseline justify-between gap-3">
      <h1 class="text-xl font-bold">Settings</h1>
      <span class="shrink-0 text-xs text-slate-500" title="App version">{{ appVersion }}</span>
    </div>
    <div class="space-y-2">
      <RouterLink
        v-for="p in pages"
        :key="p.to"
        :to="p.to"
        class="flex items-center gap-3 zui-card hover:ring-slate-700"
      >
        <component :is="p.icon" class="h-5 w-5 shrink-0 text-emerald-400" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">{{ p.label }}</p>
          <p class="truncate text-xs text-slate-500">{{ p.desc }}</p>
        </div>
        <ChevronRight class="h-4 w-4 shrink-0 text-slate-600" />
      </RouterLink>
    </div>
  </div>
</template>
