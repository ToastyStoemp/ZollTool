<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { getSetting, setSetting, setSyncedSetting } from '@/db/repo';
import { allProviders } from '@/payments/registry';
import { SUMUP_KEY_SETTING } from '@/payments/sumup';
import { REMOTE_CARBON_DEVICE_KEY } from '@/payments/mypos-carbon-remote';
import type { PaymentProviderId, ProviderStatus } from '@/payments/provider';
import type { DeviceSummary } from '@zolltool/shared';
import { listDevices } from '@/sync/api';
import { showToast } from '@/lib/toast';
import SettingsShell from './SettingsShell.vue';

const settings = useSettingsStore();

const statuses = ref<Record<string, ProviderStatus & { available: boolean }>>({});
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function refreshStatuses(): Promise<void> {
  for (const p of allProviders()) {
    const available = await p.isAvailable();
    const status = available ? await p.getStatus() : { connected: false, detail: 'Not available here' };
    statuses.value[p.id] = { ...status, available };
  }
}

const sumupKey = ref('');
const remoteCarbonDeviceId = ref('');
const knownCarbons = ref<DeviceSummary[]>([]);
const carbonsLoading = ref(false);
const carbonsError = ref('');
const newMethod = ref('');

onMounted(async () => {
  refreshStatuses();
  pollTimer = setInterval(refreshStatuses, 5000);
  sumupKey.value = (await getSetting<string>(SUMUP_KEY_SETTING)) ?? '';
  remoteCarbonDeviceId.value = (await getSetting<string>(REMOTE_CARBON_DEVICE_KEY)) ?? '';
  void refreshKnownCarbons();
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

async function selectProvider(id: PaymentProviderId): Promise<void> {
  await settings.setPaymentProvider(id);
  showToast('Payment provider updated', 'success');
  refreshStatuses();
}
async function configureProvider(id: PaymentProviderId): Promise<void> {
  const provider = allProviders().find((p) => p.id === id);
  if (!provider?.configure) return;
  try {
    await provider.configure();
    showToast('Connecting…', 'info');
  } catch (err) {
    showToast(String(err), 'error');
  }
  setTimeout(refreshStatuses, 1500);
}
async function saveSumupKey(): Promise<void> {
  await setSyncedSetting(SUMUP_KEY_SETTING, sumupKey.value.trim());
  showToast('SumUp affiliate key saved', 'success');
}

/** Devices seen with flavor='carbon' on this account, newest-seen first. */
async function refreshKnownCarbons(): Promise<void> {
  carbonsLoading.value = true;
  carbonsError.value = '';
  try {
    knownCarbons.value = (await listDevices()).filter((d) => d.flavor === 'carbon');
  } catch (err) {
    carbonsError.value = err instanceof Error ? err.message : String(err);
  } finally {
    carbonsLoading.value = false;
  }
}
async function saveRemoteCarbonDeviceId(): Promise<void> {
  await setSetting(REMOTE_CARBON_DEVICE_KEY, remoteCarbonDeviceId.value.trim());
  showToast('Remote Carbon device ID saved', 'success');
  refreshStatuses();
}
function fmtLastSeen(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function addMethod(): Promise<void> {
  await settings.addCustomPaymentMethod(newMethod.value);
  newMethod.value = '';
}
</script>

<template>
  <SettingsShell title="Payments">
    <!-- Card payment terminal -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <h2 class="mb-3 text-sm font-semibold text-slate-300">Card payment terminal</h2>
      <div class="space-y-2">
        <div
          v-for="p in allProviders()"
          :key="p.id"
          class="flex items-center gap-3 rounded-lg p-3 ring-1"
          :class="settings.paymentProviderId === p.id ? 'bg-emerald-950/40 ring-emerald-700' : 'bg-slate-800/50 ring-slate-700'"
        >
          <input
            type="radio"
            name="provider"
            :checked="settings.paymentProviderId === p.id"
            :disabled="!statuses[p.id]?.available"
            @change="selectProvider(p.id)"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium" :class="{ 'opacity-40': !statuses[p.id]?.available }">{{ p.label }}</p>
            <p class="text-xs text-slate-500">{{ statuses[p.id]?.detail || '…' }}</p>
          </div>
          <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="statuses[p.id]?.connected ? 'bg-emerald-400' : 'bg-slate-600'" />
          <button
            v-if="p.configure && statuses[p.id]?.available"
            class="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600"
            @click="configureProvider(p.id)"
          >
            Connect
          </button>
        </div>
      </div>
      <label v-if="statuses['sumup']?.available" class="mt-3 block text-sm">
        <span class="text-slate-400">SumUp affiliate key</span>
        <input
          v-model="sumupKey"
          type="text"
          placeholder="From the SumUp developer dashboard"
          class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 font-mono text-xs"
          @change="saveSumupKey"
        />
      </label>
      <div v-if="settings.paymentProviderId === 'mypos-carbon-remote'" class="mt-3">
        <div class="mb-1 flex items-center justify-between">
          <span class="text-sm text-slate-400">Remote Carbon terminal</span>
          <button class="text-[11px] text-slate-500 hover:text-slate-300 disabled:opacity-40" :disabled="carbonsLoading" @click="refreshKnownCarbons">
            {{ carbonsLoading ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>
        <select
          v-if="knownCarbons.length"
          v-model="remoteCarbonDeviceId"
          class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          @change="saveRemoteCarbonDeviceId"
        >
          <option value="" disabled>Choose a Carbon…</option>
          <option v-for="d in knownCarbons" :key="d.id" :value="d.id">{{ d.name || d.id }} — seen {{ fmtLastSeen(d.lastSeenAt) }}</option>
        </select>
        <p v-else-if="carbonsError" class="text-xs text-red-400">{{ carbonsError }}</p>
        <p v-else class="text-xs text-slate-500">
          No Carbon terminals seen on this account yet — open the app on it at least once, or paste its Device ID manually below.
        </p>
        <label class="mt-2 block text-xs">
          <span class="text-slate-500">{{ knownCarbons.length ? 'Or paste a Device ID manually' : 'Device ID' }}</span>
          <input
            v-model="remoteCarbonDeviceId"
            type="text"
            placeholder="Find this in Settings on the Carbon itself"
            class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 font-mono text-xs"
            @change="saveRemoteCarbonDeviceId"
          />
        </label>
      </div>
    </section>

    <!-- Extra payment methods -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Extra payment methods</h2>
      <p class="mb-3 text-xs text-slate-500">
        Extra buttons on the sell screen for payments handled outside the app, e.g. TWINT or a PayPal QR code. Sales made with them count as non-cash in the history.
      </p>
      <ul v-if="settings.customPaymentMethods.length" class="mb-3 space-y-2">
        <li
          v-for="m in settings.customPaymentMethods"
          :key="m"
          class="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2 text-sm ring-1 ring-slate-700"
        >
          <span class="truncate">{{ m }}</span>
          <button class="rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-red-950" @click="settings.removeCustomPaymentMethod(m)">Remove</button>
        </li>
      </ul>
      <form class="flex gap-2" @submit.prevent="addMethod">
        <input v-model="newMethod" type="text" placeholder="e.g. TWINT" class="min-w-0 flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm" />
        <button
          type="submit"
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
          :disabled="!newMethod.trim()"
        >
          Add
        </button>
      </form>
    </section>
  </SettingsShell>
</template>
