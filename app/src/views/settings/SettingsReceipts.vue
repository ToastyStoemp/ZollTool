<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { getSetting, setSetting, setSyncedSetting } from '@/db/repo';
import { showToast } from '@/lib/toast';
import {
  RECEIPT_KEYS,
  loadReceiptConfig,
  printReceipt,
  printingAvailable,
  processLogoFile,
  processLogoForScreen,
  type ArtistInfo,
  type ReceiptLine,
} from '@/lib/receipt';
import { ThermalPrinter, hasNativePlugin } from '@/native/plugins';
import SettingsShell from './SettingsShell.vue';

const artistDraft = reactive<Required<ArtistInfo>>({
  companyName: '',
  fullName: '',
  street: '',
  postCodeCity: '',
  countryOfOrigin: '',
  phone: '',
  email: '',
  vatNumber: '',
});
const receiptLogo = ref('');
const receiptFooterDraft = ref('');
const receiptAutoPrint = ref(false);
const artistSaved = ref(false);
const logoInput = ref<HTMLInputElement | null>(null);

const isCarbon = hasNativePlugin('CarbonPayment');
const hasThermalPlugin = hasNativePlugin('ThermalPrinter') && !isCarbon;
const canPrint = ref(false);
const printerName = ref('');
const printerChoices = ref<Array<{ name: string; address: string }>>([]);
const printerBusy = ref(false);

async function refreshPrintAvailability(): Promise<void> {
  canPrint.value = await printingAvailable();
}

onMounted(async () => {
  const artist = (await getSetting<ArtistInfo>(RECEIPT_KEYS.artist)) ?? {};
  for (const key of Object.keys(artistDraft) as (keyof ArtistInfo)[]) {
    if (typeof artist[key] === 'string') artistDraft[key] = artist[key] as string;
  }
  receiptLogo.value = (await getSetting<string>(RECEIPT_KEYS.logoB64)) ?? '';
  receiptFooterDraft.value = (await getSetting<string>(RECEIPT_KEYS.footerText)) ?? '';
  receiptAutoPrint.value = (await getSetting<boolean>(RECEIPT_KEYS.autoPrint)) ?? false;
  printerName.value = (await getSetting<string>(RECEIPT_KEYS.printerName)) ?? '';
  await refreshPrintAvailability();
});

async function findPrinters(): Promise<void> {
  try {
    const { printers } = await ThermalPrinter.listPrinters();
    printerChoices.value = printers;
    if (!printers.length) {
      showToast('No paired Bluetooth devices — pair the printer in Android Bluetooth settings first', 'info');
    }
  } catch (err) {
    showToast(String(err), 'error');
  }
}
async function selectPrinter(e: Event): Promise<void> {
  const address = (e.target as HTMLSelectElement).value;
  const choice = printerChoices.value.find((p) => p.address === address);
  if (!choice) return;
  await setSetting(RECEIPT_KEYS.printerAddress, choice.address);
  await setSetting(RECEIPT_KEYS.printerName, choice.name);
  printerName.value = choice.name;
  printerChoices.value = [];
  await refreshPrintAvailability();
  showToast(`Printer set: ${choice.name}`, 'success');
}
async function forgetPrinter(): Promise<void> {
  await setSetting(RECEIPT_KEYS.printerAddress, undefined);
  await setSetting(RECEIPT_KEYS.printerName, undefined);
  printerName.value = '';
  await refreshPrintAvailability();
}
async function testPrint(): Promise<void> {
  printerBusy.value = true;
  try {
    const config = await loadReceiptConfig();
    const lines: ReceiptLine[] = [];
    if (config.logoB64) lines.push({ kind: 'image', imageB64: config.logoB64 });
    if (config.artist.companyName) {
      lines.push({ kind: 'text', text: config.artist.companyName, align: 'center', doubleHeight: true });
    }
    lines.push({ kind: 'text', text: 'Printer test', align: 'center' });
    lines.push({ kind: 'text', text: '-'.repeat(32) });
    lines.push({ kind: 'text', text: new Date().toLocaleString() });
    lines.push({ kind: 'space' });
    const result = await printReceipt(lines);
    showToast(result.printed ? 'Test receipt printed' : `Print failed: ${result.error}`, result.printed ? 'success' : 'error');
  } catch (err) {
    showToast(`Print failed: ${err instanceof Error ? err.message : err}`, 'error');
  } finally {
    printerBusy.value = false;
  }
}
async function saveArtistInfo(): Promise<void> {
  await setSyncedSetting(RECEIPT_KEYS.artist, { ...artistDraft });
  await setSyncedSetting(RECEIPT_KEYS.footerText, receiptFooterDraft.value);
  artistSaved.value = true;
  setTimeout(() => (artistSaved.value = false), 2000);
}
async function onLogoFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    receiptLogo.value = await processLogoFile(file);
    await setSyncedSetting(RECEIPT_KEYS.logoB64, receiptLogo.value);
    await setSyncedSetting(RECEIPT_KEYS.logoScreenB64, await processLogoForScreen(file));
  } catch (err) {
    showToast(`Logo failed: ${err}`, 'error');
  }
}
async function removeLogo(): Promise<void> {
  receiptLogo.value = '';
  await setSyncedSetting(RECEIPT_KEYS.logoB64, '');
  await setSyncedSetting(RECEIPT_KEYS.logoScreenB64, '');
}
async function toggleAutoPrint(): Promise<void> {
  receiptAutoPrint.value = !receiptAutoPrint.value;
  await setSetting(RECEIPT_KEYS.autoPrint, receiptAutoPrint.value);
}
</script>

<template>
  <SettingsShell title="Artist &amp; receipts">
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Artist info &amp; receipts</h2>
      <p class="mb-3 text-xs text-slate-500">
        Prefills customs documents<template v-if="canPrint"> and is printed as the header on receipts</template>.
      </p>
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-sm">
          <span class="text-slate-400">Company / artist name</span>
          <input v-model="artistDraft.companyName" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Full name</span>
          <input v-model="artistDraft.fullName" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Street</span>
          <input v-model="artistDraft.street" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Postcode + city</span>
          <input v-model="artistDraft.postCodeCity" placeholder="9000 Gent" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Country</span>
          <input v-model="artistDraft.countryOfOrigin" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">VAT / UID number</span>
          <input v-model="artistDraft.vatNumber" placeholder="CHE-123.456.789 MWST" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Phone</span>
          <input v-model="artistDraft.phone" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Email</span>
          <input v-model="artistDraft.email" type="email" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
      </div>

      <label class="mt-3 block text-sm">
        <span class="text-slate-400">Receipt footer (e.g. thank-you note, return policy)</span>
        <textarea
          v-model="receiptFooterDraft"
          rows="2"
          class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
          placeholder="Thank you for your purchase!"
        ></textarea>
      </label>

      <!-- Receipt logo -->
      <div class="mt-3 flex items-center gap-3">
        <div>
          <span class="text-sm text-slate-400">Receipt logo</span>
          <p class="text-xs text-slate-500">Printed on top; scaled to the 384px paper width.</p>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <img
            v-if="receiptLogo"
            :src="`data:image/png;base64,${receiptLogo}`"
            alt="Receipt logo"
            class="h-10 max-w-32 rounded bg-white object-contain p-0.5"
          />
          <button class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700" @click="logoInput?.click()">
            {{ receiptLogo ? 'Replace' : 'Choose…' }}
          </button>
          <button v-if="receiptLogo" class="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-950" @click="removeLogo">Remove</button>
          <input ref="logoInput" type="file" accept="image/*" class="hidden" @change="onLogoFile" />
        </div>
      </div>

      <!-- Thermal printer (non-Carbon devices; the Carbon uses its built-in printer) -->
      <div v-if="hasThermalPlugin" class="mt-3 rounded-lg bg-slate-800/50 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="min-w-0">
            <span class="text-sm text-slate-300">Receipt printer (Bluetooth)</span>
            <p class="text-xs text-slate-500">
              {{ printerName || 'None — pair a thermal printer in Android Bluetooth settings, then select it here.' }}
            </p>
          </div>
          <div class="ml-auto flex gap-2">
            <button class="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600" @click="findPrinters">
              {{ printerName ? 'Change' : 'Select printer' }}
            </button>
            <button v-if="printerName" class="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-950" @click="forgetPrinter">Forget</button>
          </div>
        </div>
        <select v-if="printerChoices.length" class="mt-2 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm" @change="selectPrinter">
          <option value="">— pick a paired device —</option>
          <option v-for="p in printerChoices" :key="p.address" :value="p.address">{{ p.name }} ({{ p.address }})</option>
        </select>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-3">
        <label v-if="canPrint" class="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" :checked="receiptAutoPrint" @change="toggleAutoPrint" />
          Print a receipt after every sale
        </label>
        <div class="ml-auto flex gap-2">
          <button
            v-if="canPrint"
            class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
            :disabled="printerBusy"
            @click="testPrint"
          >
            {{ printerBusy ? 'Printing…' : 'Test print' }}
          </button>
          <button class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500" @click="saveArtistInfo">
            {{ artistSaved ? 'Saved ✓' : 'Save' }}
          </button>
        </div>
      </div>
    </section>
  </SettingsShell>
</template>
