<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { getSetting, setSetting, setSyncedSetting } from '@/db/repo';
import { showToast } from '@/lib/toast';
import { useSettingsStore } from '@/stores/settings';
import type { Transaction } from '@zolltool/shared';
import {
  RECEIPT_KEYS,
  buildReceiptLines,
  loadReceiptConfig,
  printReceipt,
  printingAvailable,
  processLogoFile,
  processLogoForScreen,
  type ArtistInfo,
  type ReceiptLine,
} from '@/lib/receipt';
import { ThermalPrinter, hasNativePlugin } from '@/native/plugins';
import ReceiptPreview from '@/components/ReceiptPreview.vue';
import SettingsShell from './SettingsShell.vue';

const settings = useSettingsStore();

const artistDraft = reactive<Required<ArtistInfo>>({
  companyName: '',
  fullName: '',
  street: '',
  postCodeCity: '',
  countryOfOrigin: '',
  phone: '',
  email: '',
  vatNumber: '',
  vatNumbers: [],
});
function addVatRow(): void {
  artistDraft.vatNumbers.push({ country: '', vatNumber: '' });
}
function removeVatRow(i: number): void {
  artistDraft.vatNumbers.splice(i, 1);
}
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
    const val = artist[key];
    if (typeof val === 'string') (artistDraft as unknown as Record<string, string>)[key] = val;
  }
  artistDraft.vatNumbers = Array.isArray(artist.vatNumbers)
    ? artist.vatNumbers.map((v) => ({ country: v.country ?? '', vatNumber: v.vatNumber ?? '' }))
    : [];
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
  const vatNumbers = artistDraft.vatNumbers
    .map((v) => ({ country: v.country.trim(), vatNumber: v.vatNumber.trim() }))
    .filter((v) => v.country && v.vatNumber);
  await setSyncedSetting(RECEIPT_KEYS.artist, { ...artistDraft, vatNumbers });
  await setSyncedSetting(RECEIPT_KEYS.footerText, receiptFooterDraft.value);
  artistSaved.value = true;
  setTimeout(() => (artistSaved.value = false), 2000);
}

// ── Live preview ────────────────────────────────────────────────────────────
// A sample sale; the VAT line resolves against `previewCountry` so the effect
// of the per-country VAT numbers is visible.
const previewCountry = ref('');
const sampleTx = computed<Transaction>(() => ({
  id: 'PREVIEW000A1B2C3',
  eventId: 'preview',
  deviceId: 'preview',
  timestamp: Date.now(),
  method: 'card',
  currency: settings.defaultCurrency || 'CHF',
  total: 47,
  items: [
    { pid: 'p1', vid: null, title: 'Enamel pin — Dragon', qty: 2, unitPrice: 12, lineTotal: 24 },
    { pid: 'p2', vid: 'v1', title: 'Art print A4', variantLabel: 'Forest', qty: 1, unitPrice: 25, lineTotal: 25 },
  ],
  discounts: [{ name: 'Bundle deal', amount: 2 }],
  payments: [{ kind: 'card', amount: 47, provider: 'card', cardBrand: 'VISA', authCode: '004215', txRef: '304512780093' }],
}));
const previewLines = computed<ReceiptLine[]>(() =>
  buildReceiptLines(
    sampleTx.value,
    previewCountry.value ? `Convention · ${previewCountry.value}` : 'Sample Convention',
    { artist: artistDraft, logoB64: receiptLogo.value, footerText: receiptFooterDraft.value },
    previewCountry.value || undefined,
  ),
);
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
    <section class="zui-card">
      <h2 class="mb-2 zui-card-title">Artist info &amp; receipts</h2>
      <p class="mb-3 text-xs text-slate-500">
        Prefills customs documents<template v-if="canPrint"> and is printed as the header on receipts</template>.
      </p>
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-sm">
          <span class="text-slate-400">Company / artist name</span>
          <input v-model="artistDraft.companyName" class="mt-1 w-full zui-input" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Full name</span>
          <input v-model="artistDraft.fullName" class="mt-1 w-full zui-input" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Street</span>
          <input v-model="artistDraft.street" class="mt-1 w-full zui-input" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Postcode + city</span>
          <input v-model="artistDraft.postCodeCity" placeholder="9000 Gent" class="mt-1 w-full zui-input" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Country</span>
          <input v-model="artistDraft.countryOfOrigin" class="mt-1 w-full zui-input" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Default VAT / UID number</span>
          <input v-model="artistDraft.vatNumber" placeholder="CHE-123.456.789 MWST" class="mt-1 w-full zui-input" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Phone</span>
          <input v-model="artistDraft.phone" class="mt-1 w-full zui-input" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Email</span>
          <input v-model="artistDraft.email" type="email" class="mt-1 w-full zui-input" />
        </label>
      </div>

      <!-- Per-country VAT numbers -->
      <div class="mt-3">
        <div class="mb-1 flex items-center justify-between">
          <span class="text-sm text-slate-400">Country-specific VAT numbers</span>
          <button class="text-[11px] font-medium text-emerald-400 hover:text-emerald-300" @click="addVatRow">+ Add country</button>
        </div>
        <p class="mb-2 text-xs text-slate-500">
          Receipts use the number matching the <strong>event's country</strong>; the default above is used when there's no match.
        </p>
        <div v-for="(v, i) in artistDraft.vatNumbers" :key="i" class="mb-2 flex gap-2">
          <input v-model="v.country" placeholder="Country, e.g. Germany" class="w-1/3 min-w-0 zui-input" />
          <input v-model="v.vatNumber" placeholder="VAT / UID number" class="min-w-0 flex-1 zui-input" />
          <button class="rounded-lg px-3 text-sm text-red-400 hover:bg-red-950" aria-label="Remove" @click="removeVatRow(i)">✕</button>
        </div>
      </div>

      <label class="mt-3 block text-sm">
        <span class="text-slate-400">Receipt footer (e.g. thank-you note, return policy)</span>
        <textarea
          v-model="receiptFooterDraft"
          rows="2"
          class="mt-1 w-full zui-input"
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
        <select v-if="printerChoices.length" class="mt-2 w-full zui-input" @change="selectPrinter">
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
          <button class="zui-btn zui-btn-primary" @click="saveArtistInfo">
            {{ artistSaved ? 'Saved ✓' : 'Save' }}
          </button>
        </div>
      </div>
    </section>

    <!-- Live receipt preview -->
    <section class="zui-card">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <h2 class="zui-card-title">Receipt preview</h2>
        <label class="ml-auto text-xs text-slate-400">
          Event country:
          <select v-model="previewCountry" class="ml-1 rounded bg-slate-800 px-2 py-1 text-xs">
            <option value="">Default</option>
            <option v-for="v in artistDraft.vatNumbers.filter((x) => x.country.trim())" :key="v.country" :value="v.country">
              {{ v.country }}
            </option>
          </select>
        </label>
      </div>
      <p class="mb-3 text-xs text-slate-500">
        A sample sale, updating live as you edit. Pick an event country to see which VAT number prints.
      </p>
      <div class="flex justify-center rounded-xl bg-slate-950/60 p-4">
        <ReceiptPreview :lines="previewLines" />
      </div>
    </section>
  </SettingsShell>
</template>
