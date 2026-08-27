<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { getSetting, setSetting } from '@/db/repo';
import { showToast } from '@/lib/toast';
import { DisplayLink, ThermalPrinter, hasNativePlugin } from '@/native/plugins';
import { DISPLAY_KEYS } from '@/lib/display';
import { MonitorSmartphone } from 'lucide-vue-next';
import SettingsShell from './SettingsShell.vue';

const settings = useSettingsStore();

const deviceNameDraft = ref('');
const currencyDraft = ref('');
const roundingDraft = ref('0');

async function saveDeviceName(): Promise<void> {
  await settings.setDeviceName(deviceNameDraft.value.trim());
}
async function saveCurrency(): Promise<void> {
  await settings.setDefaultCurrency(currencyDraft.value);
  currencyDraft.value = settings.defaultCurrency;
}
async function saveRounding(): Promise<void> {
  await settings.setDefaultRoundingIncrement(Number(roundingDraft.value));
  roundingDraft.value = String(settings.defaultRoundingIncrement);
}

watch(
  () => settings.ready,
  (ready) => {
    if (!ready) return;
    deviceNameDraft.value = settings.deviceName;
    currencyDraft.value = settings.defaultCurrency;
    roundingDraft.value = String(settings.defaultRoundingIncrement);
  },
  { immediate: true },
);

// ── Bluetooth customer display (register side) ──────────────────────────────
const hasDisplayLink = hasNativePlugin('DisplayLink');
const btDisplayName = ref('');
const btDisplayChoices = ref<Array<{ name: string; address: string }>>([]);

onMounted(async () => {
  btDisplayName.value = (await getSetting<string>(DISPLAY_KEYS.btName)) ?? '';
});

async function findBtDisplays(): Promise<void> {
  try {
    const { printers } = await ThermalPrinter.listPrinters(); // bonded devices, any kind
    btDisplayChoices.value = printers;
    if (!printers.length) {
      showToast('No paired devices — pair the display device in Android Bluetooth settings first', 'info');
    }
  } catch (err) {
    showToast(String(err), 'error');
  }
}
async function selectBtDisplay(e: Event): Promise<void> {
  const address = (e.target as HTMLSelectElement).value;
  const choice = btDisplayChoices.value.find((p) => p.address === address);
  if (!choice) return;
  await setSetting(DISPLAY_KEYS.btAddress, choice.address);
  await setSetting(DISPLAY_KEYS.btName, choice.name);
  await DisplayLink.configure({ address: choice.address }).catch(() => {});
  btDisplayName.value = choice.name;
  btDisplayChoices.value = [];
  showToast(`Customer display: ${choice.name}`, 'success');
}
async function forgetBtDisplay(): Promise<void> {
  await setSetting(DISPLAY_KEYS.btAddress, undefined);
  await setSetting(DISPLAY_KEYS.btName, undefined);
  await DisplayLink.disconnect().catch(() => {});
  btDisplayName.value = '';
}
</script>

<template>
  <SettingsShell title="Device">
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <h2 class="mb-3 text-sm font-semibold text-slate-300">This device</h2>
      <label class="block text-sm">
        <span class="text-slate-400">Device name</span>
        <input
          v-model="deviceNameDraft"
          placeholder="e.g. Wolf's tablet"
          class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
          @change="saveDeviceName"
        />
      </label>
      <label class="mt-3 block text-sm">
        <span class="text-slate-400">Default currency (prefilled for new events)</span>
        <input
          v-model="currencyDraft"
          placeholder="CHF"
          class="mt-1 w-24 rounded-lg bg-slate-800 px-3 py-2 uppercase"
          @change="saveCurrency"
        />
      </label>
      <label class="mt-3 block text-sm">
        <span class="text-slate-400">Default rounding increment (prefilled for new events)</span>
        <select v-model="roundingDraft" class="mt-1 w-24 rounded-lg bg-slate-800 px-3 py-2" @change="saveRounding">
          <option value="0">Off</option>
          <option value="1">1</option>
          <option value="5">5</option>
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </label>
      <p class="mt-2 text-xs text-slate-500">Device ID: {{ settings.deviceId }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
          @click="settings.reopenOnboarding()"
        >
          Run setup guide
        </button>
        <RouterLink
          v-if="settings.syncUser || hasDisplayLink"
          to="/display"
          class="flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
        >
          <MonitorSmartphone class="h-4 w-4" /> Customer display mode
        </RouterLink>
      </div>

      <!-- Bluetooth customer display (register side) -->
      <div v-if="hasDisplayLink" class="mt-3 rounded-lg bg-slate-800/50 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="min-w-0">
            <span class="text-sm text-slate-300">Customer display (Bluetooth)</span>
            <p class="text-xs text-slate-500">
              {{ btDisplayName || 'None — pair the display device in Android Bluetooth settings, then select it here. It must be in "Customer display mode".' }}
            </p>
          </div>
          <div class="ml-auto flex gap-2">
            <button class="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600" @click="findBtDisplays">
              {{ btDisplayName ? 'Change' : 'Select device' }}
            </button>
            <button
              v-if="btDisplayName"
              class="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
              @click="forgetBtDisplay"
            >
              Forget
            </button>
          </div>
        </div>
        <select v-if="btDisplayChoices.length" class="mt-2 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" @change="selectBtDisplay">
          <option value="">— pick a paired device —</option>
          <option v-for="p in btDisplayChoices" :key="p.address" :value="p.address">{{ p.name }} ({{ p.address }})</option>
        </select>
      </div>
    </section>
  </SettingsShell>
</template>
