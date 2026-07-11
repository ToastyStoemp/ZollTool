<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  ClipboardList,
  Coins,
  Download,
  FileInput,
  FileOutput,
  FolderArchive,
  Receipt,
} from 'lucide-vue-next';
import { useDataStore } from '@/stores/data';
import { getSetting, upsertEvent } from '@/db/repo';
import { isNative } from '@/native/plugins';
import { saveTextFile, shareTextFile } from '@/lib/download';
import { showToast } from '@/lib/toast';
import { buildCustomsState, readCustomsBlob } from '@/customs/adapter';
import { defaultCustomsArtist, defaultCustomsEdec, defaultCustomsForm1174 } from '@/customs/model';
import { compute1174Groups, computeLRP, fmtWeightKg } from '@/customs/calc';
import { buildEdecXml } from '@/customs/edec-xml';
import { buildGoodsListHtml, type GoodsDocNum, type GoodsFormat } from '@/customs/goods-list';
import { buildAllVersionsHtml } from '@/customs/all-versions';
import { buildProformaHtml } from '@/customs/proforma';
import { build1174Html } from '@/customs/form1174';
import { build1187Html } from '@/customs/form1187';
import CountryPicker from '@/components/CountryPicker.vue';

const data = useDataStore();
const route = useRoute();

/** The event this customs page belongs to: route param first, active event as fallback. */
const currentEvent = computed(
  () => data.events.find((e) => e.id === route.params.eventId) ?? data.activeEvent,
);

// ── Editable customs settings (persisted into event.customs) ────────────────
const artist = ref(defaultCustomsArtist());
const edec = ref(defaultCustomsEdec());
const form1174 = ref(defaultCustomsForm1174());
const companyCode = ref('');
const documentNumber = ref(1);
const venueName = ref('');
const eventLocation = ref('');
const venueTIN = ref('');

let loadedEventId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let loading = false;

/** Keep only filled-in fields so defaults aren't clobbered by empty strings. */
function stripEmpty<T extends Record<string, unknown>>(obj: T | undefined): Partial<T> {
  if (!obj) return {};
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null)) as Partial<T>;
}

watch(
  () => currentEvent.value,
  async (event) => {
    if (!event || event.id === loadedEventId) return;
    loadedEventId = event.id;
    loading = true;
    const blob = readCustomsBlob(event);
    // Artist defaults from the setup guide pre-fill events without own data
    const artistDefaults = await getSetting<Record<string, string>>('customs.artistDefaults');
    artist.value = { ...defaultCustomsArtist(), ...stripEmpty(artistDefaults), ...stripEmpty(blob.artist) };
    edec.value = { ...defaultCustomsEdec(), ...(blob.edec ?? {}) };
    const f = { ...defaultCustomsForm1174(), ...(blob.form1174 ?? {}) };
    if (!Array.isArray(f.assignments)) f.assignments = [];
    form1174.value = f as typeof form1174.value;
    companyCode.value = blob.meta?.companyCode ?? '';
    documentNumber.value = blob.meta?.documentNumber ?? 1;
    venueName.value = blob.meta?.venueName ?? '';
    eventLocation.value = blob.meta?.eventLocation ?? '';
    venueTIN.value = blob.meta?.venueTIN ?? event.venue.tin ?? '';
    setTimeout(() => (loading = false));
  },
  { immediate: true },
);

function scheduleSave(): void {
  if (loading || !currentEvent.value) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCustoms, 600);
}

async function saveCustoms(): Promise<void> {
  const event = currentEvent.value;
  if (!event) return;
  const blob = readCustomsBlob(event);
  await upsertEvent({
    ...event,
    customs: {
      ...event.customs,
      artist: { ...artist.value },
      edec: { ...edec.value },
      form1174: JSON.parse(JSON.stringify(form1174.value)),
      meta: {
        ...blob.meta,
        companyCode: companyCode.value,
        documentNumber: documentNumber.value,
        venueName: venueName.value,
        eventLocation: eventLocation.value,
        venueTIN: venueTIN.value,
      },
    },
    updatedAt: Date.now(),
  });
}

watch([artist, edec, form1174, companyCode, documentNumber, venueName, eventLocation, venueTIN], scheduleSave, {
  deep: true,
});

/** Auto company code from the artist name initials, e.g. "Get Up Games" → "GUG". */
const autoCompanyCode = computed(() => {
  const name = (artist.value.companyName || artist.value.fullName || '').trim();
  if (!name) return '';
  const words = name.split(/\s+/).filter(Boolean);
  const raw = words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 3);
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
});

/** The code actually used for LRP: the user's custom code, or the auto one. */
const effectiveCompanyCode = computed(() => companyCode.value.trim() || autoCompanyCode.value);

// ── Live customs state for the generators ────────────────────────────────────
const customsState = computed(() => {
  if (!currentEvent.value) return null;
  const event = {
    ...currentEvent.value,
    customs: {
      artist: artist.value,
      edec: edec.value,
      form1174: form1174.value,
      meta: {
        companyCode: effectiveCompanyCode.value,
        documentNumber: documentNumber.value,
        venueName: venueName.value,
        eventLocation: eventLocation.value,
        venueTIN: venueTIN.value,
      },
    },
  };
  return buildCustomsState(event, data.products, data.allStock, data.allTransactions);
});

const lrp = computed(() => (customsState.value ? computeLRP(customsState.value, documentNumber.value) : ''));

const groups = computed(() => {
  if (!customsState.value) return null;
  // compute1174Groups pads the assignments array in place — give it a copy
  return compute1174Groups(JSON.parse(JSON.stringify(customsState.value)));
});

function setAssignment(index: number, group: 1 | 2): void {
  const asn = [...form1174.value.assignments];
  while (asn.length < (customsState.value?.products.length ?? 0)) asn.push(0);
  asn[index] = group;
  form1174.value = { ...form1174.value, assignments: asn };
}

// ── Document generation ──────────────────────────────────────────────────────
const goodsFormat = ref<GoodsFormat>('detailed');

// Detailed vs compressed only differ when variant products exist — otherwise
// both are one row per product, so offering the choice is just noise.
const hasVariantProducts = computed(
  () => customsState.value?.products.some((p) => !p.unlisted && (p.variants?.length ?? 0) > 0) ?? false,
);
const formatOptions = computed<{ value: GoodsFormat; label: string }[]>(() =>
  hasVariantProducts.value
    ? [
        { value: 'detailed', label: 'Detailed' },
        { value: 'compressed', label: 'Compressed' },
        { value: 'bytype', label: 'By type' },
      ]
    : [
        { value: 'detailed', label: 'Per product' },
        { value: 'bytype', label: 'By type' },
      ],
);

watch(hasVariantProducts, (has) => {
  if (!has && goodsFormat.value === 'compressed') goodsFormat.value = 'detailed';
});

function safeName(suffix: string): string {
  return `${(currentEvent.value?.name || 'event').replace(/[^\w-]+/g, '_')}_${suffix}`;
}

async function openHtml(filename: string, html: string): Promise<void> {
  if (isNative) {
    // Share sheet: open in a browser to print, or save the file
    await shareTextFile(filename, html, 'text/html');
    return;
  }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const win = window.open(url, '_blank');
  if (!win) showToast('Pop-up blocked - allow pop-ups and try again.', 'error');
}

async function exportEdec(): Promise<void> {
  if (!customsState.value) return;
  const result = buildEdecXml(customsState.value);
  if (!result) {
    showToast('No products have sold quantities > 0 yet.', 'error');
    return;
  }
  await saveTextFile(result.filename, result.xml, 'application/xml');
}

const openGoodsList = (docNum: GoodsDocNum) =>
  openHtml(safeName(`goods_${docNum}.html`), buildGoodsListHtml(customsState.value!, docNum, goodsFormat.value));
const openAllFormats = () => openHtml(safeName('goods_all.html'), buildAllVersionsHtml(customsState.value!));
const openProforma = () => openHtml(safeName('proforma.html'), buildProformaHtml(customsState.value!));
const open1174 = () => openHtml(safeName('form_1174.html'), build1174Html(customsState.value!));
const open1187 = () => openHtml(safeName('form_1187.html'), build1187Html(customsState.value!));

const TRANSPORT_MODES = [
  ['1', '1 - Sea'],
  ['2', '2 - Rail'],
  ['3', '3 - Road'],
  ['4', '4 - Air'],
  ['5', '5 - Postal / Mail'],
  ['9', '9 - Own propulsion'],
] as const;
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink to="/events" class="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800">←</RouterLink>
      <h1 class="text-xl font-bold">Customs</h1>
      <span v-if="currentEvent" class="text-sm text-slate-400">{{ currentEvent.name }}</span>
    </div>

    <p v-if="!currentEvent" class="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400">
      Event not found — open Customs from an event card under Events. Customs data is stored per event.
    </p>

    <template v-else>
      <!-- Documents -->
      <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-1 text-sm font-semibold text-slate-300">Documents</h2>
        <p class="mb-3 text-xs text-slate-500">
          LRP: <span class="font-mono text-slate-300">{{ lrp }}</span>
          <span v-if="isNative"> · Documents open via the share sheet — open in a browser to print.</span>
        </p>
        <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span class="text-xs text-slate-400">Goods list format:</span>
          <div class="flex rounded-lg bg-slate-800 p-1">
            <button
              v-for="opt in formatOptions"
              :key="opt.value"
              class="rounded-md px-3 py-1 text-xs"
              :class="goodsFormat === opt.value ? 'bg-slate-600 font-semibold' : 'text-slate-400'"
              @click="goodsFormat = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button class="flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2.5 text-sm font-medium hover:bg-slate-700" @click="openGoodsList(1)">
            <FileInput class="h-4 w-4 shrink-0" /> Import list
          </button>
          <button class="flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2.5 text-sm font-medium hover:bg-slate-700" @click="openGoodsList(2)">
            <Coins class="h-4 w-4 shrink-0" /> Sold goods list
          </button>
          <button class="flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2.5 text-sm font-medium hover:bg-slate-700" @click="openGoodsList(3)">
            <FileOutput class="h-4 w-4 shrink-0" /> Return goods list
          </button>
          <button class="flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2.5 text-sm font-medium hover:bg-slate-700" @click="openAllFormats">
            <FolderArchive class="h-4 w-4 shrink-0" /> All formats bundle
          </button>
          <button class="flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2.5 text-sm font-medium hover:bg-slate-700" @click="openProforma">
            <Receipt class="h-4 w-4 shrink-0" /> Proforma invoice
          </button>
          <button class="flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2.5 text-sm font-medium hover:bg-slate-700" @click="open1174">
            <ClipboardList class="h-4 w-4 shrink-0" /> Form 11.74
          </button>
          <button class="flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2.5 text-sm font-medium hover:bg-slate-700" @click="open1187">
            <ClipboardList class="h-4 w-4 shrink-0" /> Form 11.87
          </button>
          <button
            class="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600"
            @click="exportEdec"
          >
            <Download class="h-4 w-4 shrink-0" /> e-dec XML
          </button>
        </div>
      </section>

      <!-- Artist / sender -->
      <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-3 text-sm font-semibold text-slate-300">Artist / sender</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Company name</span>
            <input v-model="artist.companyName" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Full name</span>
            <input v-model="artist.fullName" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Street &amp; house number</span>
            <input v-model="artist.street" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Postcode &amp; city</span>
            <input v-model="artist.postCodeCity" placeholder="9000 Gent" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Country of origin</span>
            <CountryPicker v-model="artist.countryOfOrigin" mode="name" placeholder="Belgium" class="mt-1" />
          </label>
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Phone</span>
            <input v-model="artist.phone" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm sm:col-span-2">
            <span class="text-xs text-slate-400">Email</span>
            <input v-model="artist.email" type="email" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
        </div>
      </section>

      <!-- Declaration details -->
      <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-3 text-sm font-semibold text-slate-300">Declaration details</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block text-sm">
            <span class="text-xs text-slate-400">
              Company code (for LRP)
              <span v-if="!companyCode.trim() && autoCompanyCode" class="text-emerald-500">
                — auto: {{ autoCompanyCode }}
              </span>
            </span>
            <input
              v-model="companyCode"
              :placeholder="autoCompanyCode || 'e.g. GUG'"
              class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
            />
          </label>
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Document number</span>
            <input v-model.number="documentNumber" type="number" min="1" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Venue / organiser name</span>
            <input v-model="venueName" placeholder="e.g. Messe Basel" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Venue TIN</span>
            <input v-model="venueTIN" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 font-mono text-xs" />
          </label>
          <label class="block text-sm sm:col-span-2">
            <span class="text-xs text-slate-400">Event location (shown on documents)</span>
            <input v-model="eventLocation" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
        </div>
        <p class="mt-2 text-xs text-slate-500">
          Venue address and event dates come from the event itself — edit them under Events.
        </p>
      </section>

      <!-- Transport -->
      <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-3 text-sm font-semibold text-slate-300">Transport (e-dec / forms)</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Transport mode</span>
            <select v-model="edec.transportMode" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2">
              <option v-for="[value, label] in TRANSPORT_MODES" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Vehicle country</span>
            <CountryPicker v-model="edec.transportationCountry" mode="code" placeholder="BE" class="mt-1" />
          </label>
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Vehicle / plate number</span>
            <input v-model="edec.transportationNumber" placeholder="1-KDE-308" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label v-if="edec.transportMode === '4'" class="block text-sm">
            <span class="text-xs text-slate-400">Flight number (form 11.74 field 6)</span>
            <input v-model="edec.flightNumber" placeholder="LX1234" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
        </div>
      </section>

      <!-- 11.74 grouping -->
      <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-3 text-sm font-semibold text-slate-300">Form 11.74 / 11.87 goods grouping</h2>
        <div class="mb-3 flex rounded-lg bg-slate-800 p-1 text-sm" style="max-width: 280px">
          <button
            class="flex-1 rounded-md px-3 py-1.5"
            :class="form1174.groupMode === 'auto' ? 'bg-slate-600 font-semibold' : 'text-slate-400'"
            @click="form1174 = { ...form1174, groupMode: 'auto' }"
          >
            Automatic
          </button>
          <button
            class="flex-1 rounded-md px-3 py-1.5"
            :class="form1174.groupMode === 'manual' ? 'bg-slate-600 font-semibold' : 'text-slate-400'"
            @click="form1174 = { ...form1174, groupMode: 'manual' }"
          >
            Manual
          </button>
        </div>

        <div v-if="groups" class="mb-3 grid gap-2 sm:grid-cols-2">
          <div class="rounded-lg bg-slate-800/60 p-3 text-xs">
            <p class="mb-1 font-semibold text-slate-300">Group 1 · {{ groups.g1.tariffNo }}</p>
            <p class="text-slate-400">
              {{ groups.g1.qty }} items · {{ fmtWeightKg(groups.g1.weightKg) }} ·
              {{ Math.floor(groups.g1.value) }} {{ currentEvent?.currency }}
            </p>
          </div>
          <div class="rounded-lg bg-slate-800/60 p-3 text-xs" :class="{ 'opacity-40': !groups.hasG2 }">
            <p class="mb-1 font-semibold text-slate-300">Group 2 · {{ groups.g2.tariffNo }}</p>
            <p class="text-slate-400">
              {{ groups.g2.qty }} items · {{ fmtWeightKg(groups.g2.weightKg) }} ·
              {{ Math.floor(groups.g2.value) }} {{ currentEvent?.currency }}
            </p>
          </div>
        </div>

        <div v-if="form1174.groupMode === 'manual' && customsState" class="space-y-1">
          <div
            v-for="(p, i) in customsState.products"
            :key="p.id ?? i"
            class="flex items-center gap-2 rounded-lg bg-slate-800/40 px-3 py-1.5 text-sm"
          >
            <span class="min-w-0 flex-1 truncate">{{ p.title }}</span>
            <span class="text-xs text-slate-500">{{ p.tariffNo || '—' }}</span>
            <div class="flex rounded-md bg-slate-800 p-0.5">
              <button
                class="rounded px-2.5 py-0.5 text-xs"
                :class="form1174.assignments[i] === 1 ? 'bg-emerald-700 font-semibold text-white' : 'text-slate-400'"
                @click="setAssignment(i, 1)"
              >
                G1
              </button>
              <button
                class="rounded px-2.5 py-0.5 text-xs"
                :class="form1174.assignments[i] !== 1 ? 'bg-slate-600 font-semibold' : 'text-slate-400'"
                @click="setAssignment(i, 2)"
              >
                G2
              </button>
            </div>
          </div>
        </div>
        <p v-else class="text-xs text-slate-500">
          Automatic: the tariff group with the highest value becomes group 1, everything else group 2.
        </p>
      </section>
    </template>
  </div>
</template>
