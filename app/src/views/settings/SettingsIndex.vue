<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ChevronRight, Smartphone, CreditCard, Receipt, ShieldCheck, Package } from 'lucide-vue-next';
import { Updater, hasNativePlugin, isNative } from '@/native/plugins';
import { getServerCommit } from '@/sync/api';

const appVersion = ref(__APP_VERSION__);
// The sync server's own commit (resolved at its boot) — shown when online so you
// can confirm the deployed server matches the app build.
const serverCommit = ref<string | null>(null);
onMounted(async () => {
  if (hasNativePlugin('Updater')) {
    try {
      appVersion.value = (await Updater.getCurrentVersion()).versionName;
    } catch {
      /* keep the build-time stamp */
    }
  }
  serverCommit.value = await getServerCommit();
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
  <div class="zui-settings-page">
    <div class="zui-settings-head">
      <h1 class="zui-title">Settings</h1>
      <!-- Web: the server serves this bundle, so its live commit is the truth.
           Native: this device's installed app build is primary; the server it
           syncs with is shown below when it differs. -->
      <span class="zui-settings-head-spacer text-right text-xs text-slate-500">
        <template v-if="!isNative">
          <span :title="serverCommit ? 'Deployed commit (live)' : 'App build'">{{ serverCommit || appVersion }}</span>
        </template>
        <template v-else>
          <span title="This device's app build">{{ appVersion }}</span>
          <span v-if="serverCommit && serverCommit !== appVersion" class="block text-[0.65rem] text-slate-600" title="Sync server's deployed commit">server {{ serverCommit }}</span>
        </template>
      </span>
    </div>
    <div class="zui-settings-list">
      <RouterLink v-for="p in pages" :key="p.to" :to="p.to" class="zui-settings-card">
        <component :is="p.icon" class="zui-settings-card-icon" />
        <div class="zui-settings-card-body">
          <span class="zui-settings-card-title">{{ p.label }}</span>
          <span class="zui-settings-card-desc">{{ p.desc }}</span>
        </div>
        <ChevronRight class="zui-settings-card-chevron" />
      </RouterLink>
    </div>
  </div>
</template>
