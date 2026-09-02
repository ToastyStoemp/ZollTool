<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { SalesEvent } from '@zolltool/shared';
import { useDataStore } from '@/stores/data';
import { useSettingsStore } from '@/stores/settings';
import { closeEvent, deleteEvent, setStock, upsertEvent } from '@/db/repo';
import { db } from '@/db/schema';
import { uuidv7 } from '@/lib/uuid';
import { fmtPrice } from '@/lib/money';
import { fetchExchangeRate } from '@/lib/exchangeRate';
import { EVENT_PRESETS } from '@/data/event-presets';
import { ArrowLeftRight, ChartLine, DoorOpen, Pencil, ShoppingCart, Stamp, Trash2 } from 'lucide-vue-next';
import ModalShell from '@/components/ModalShell.vue';
import CountryPicker from '@/components/CountryPicker.vue';
import CurrencyPicker from '@/components/CurrencyPicker.vue';
import DateRangePicker from '@/components/DateRangePicker.vue';

const data = useDataStore();
const settings = useSettingsStore();
const router = useRouter();

const showCreate = ref(false);
const editingId = ref<string | null>(null);
const confirmCloseId = ref<string | null>(null);
const confirmDeleteId = ref<string | null>(null);

const ROUNDING_INCREMENTS = [
  ['0', 'No rounding'],
  ['1', '1'],
  ['5', '5'],
  ['10', '10'],
  ['20', '20'],
  ['50', '50'],
  ['100', '100'],
] as const;

const fetchingRate = ref(false);
const fetchRateError = ref('');

const form = reactive({
  preset: '',
  name: '',
  dateStart: '',
  dateEnd: '',
  street: '',
  postcode: '',
  city: '',
  country: 'Switzerland',
  tin: '',
  localCurrency: '',
  exchangeRate: '' as string,
  roundingIncrement: '0',
  copyStockFrom: '',
});

async function fetchRate(): Promise<void> {
  if (!settings.defaultCurrency.trim() || !form.localCurrency.trim()) return;
  fetchingRate.value = true;
  fetchRateError.value = '';
  const rate = await fetchExchangeRate(settings.defaultCurrency, form.localCurrency);
  fetchingRate.value = false;
  if (rate == null) {
    fetchRateError.value = 'Could not fetch a rate — enter it manually.';
    return;
  }
  form.exchangeRate = String(rate);
}

// Sort key = the event's date (start, falling back to end); undated events sort last.
const dateKey = (e: SalesEvent): string => e.dateStart || e.dateEnd || '￿';
// Upcoming / active events, soonest first. Closed (finished) events are shown
// separately below, most-recently-finished first.
const upcomingEvents = computed(() =>
  data.events
    .filter((e) => e.status !== 'closed')
    .sort((a, b) => dateKey(a).localeCompare(dateKey(b)) || a.name.localeCompare(b.name)),
);
const closedEvents = computed(() =>
  data.events
    .filter((e) => e.status === 'closed')
    .sort((a, b) => dateKey(b).localeCompare(dateKey(a)) || b.updatedAt - a.updatedAt),
);
const hasAnyEvent = computed(() => data.events.length > 0);
const eventGroups = computed(() => [
  { label: '', events: upcomingEvents.value },
  { label: 'Finished', events: closedEvents.value },
]);

function eventStats(eventId: string): { count: number; revenue: number; currency: string } {
  let count = 0;
  let revenue = 0;
  let currency = settings.defaultCurrency;
  for (const tx of data.allTransactions) {
    if (tx.eventId !== eventId || tx.revertedBy) continue;
    count++;
    // Always sum in base/tracking currency — tx.total may be in a converted
    // local currency that changed over the life of the event.
    revenue += tx.baseTotal ?? tx.total;
    currency = tx.baseCurrency ?? tx.currency;
  }
  return { count, revenue, currency };
}

function applyPreset(): void {
  const preset = EVENT_PRESETS.find((p) => p.id === form.preset);
  if (!preset) return;
  form.name = preset.name;
  form.dateStart = preset.dateStart ?? '';
  form.dateEnd = preset.dateEnd ?? '';
  form.street = preset.venue.street ?? '';
  form.postcode = preset.venue.postcode ?? '';
  form.city = preset.venue.city ?? '';
  form.country = preset.venue.country ?? '';
  form.tin = preset.venue.tin ?? '';
}

function openCreate(): void {
  Object.assign(form, {
    preset: '',
    name: '',
    dateStart: '',
    dateEnd: '',
    street: '',
    postcode: '',
    city: '',
    country: 'Switzerland',
    tin: '',
    localCurrency: '',
    exchangeRate: '',
    roundingIncrement: String(settings.defaultRoundingIncrement),
    copyStockFrom: '',
  });
  fetchRateError.value = '';
  showCreate.value = true;
}

async function createEvent(): Promise<void> {
  if (!form.name.trim()) return;
  const localCurrency = form.localCurrency.trim().toUpperCase();
  const rate = parseFloat(form.exchangeRate);
  const event: SalesEvent = {
    id: uuidv7(),
    name: form.name.trim(),
    dateStart: form.dateStart || undefined,
    dateEnd: form.dateEnd || undefined,
    venue: {
      street: form.street || undefined,
      postcode: form.postcode || undefined,
      city: form.city || undefined,
      country: form.country || undefined,
      tin: form.tin || undefined,
    },
    currency: settings.defaultCurrency,
    localCurrency: localCurrency && Number.isFinite(rate) && rate > 0 ? localCurrency : undefined,
    exchangeRate: localCurrency && Number.isFinite(rate) && rate > 0 ? rate : undefined,
    roundingIncrement: Number(form.roundingIncrement) || 0,
    status: 'planned',
    updatedAt: Date.now(),
  };
  await upsertEvent(event);

  if (form.copyStockFrom) {
    const rows = await db.eventStock.where('eventId').equals(form.copyStockFrom).toArray();
    for (const row of rows) {
      await setStock(event.id, row.productId, row.variantId, row.broughtQty);
    }
  }

  showCreate.value = false;
  if (!settings.activeEventId) await activate(event);
}

async function activate(event: SalesEvent): Promise<void> {
  if (event.status !== 'active') {
    await upsertEvent({ ...event, status: 'active', updatedAt: Date.now() });
  }
  await settings.setActiveEvent(event.id);
}

/** Selling always goes through the event, so it's clear what you're selling for. */
async function sell(event: SalesEvent): Promise<void> {
  await activate(event);
  await router.push('/pos');
}

function openEdit(event: SalesEvent): void {
  Object.assign(form, {
    preset: '',
    name: event.name,
    dateStart: event.dateStart ?? '',
    dateEnd: event.dateEnd ?? '',
    street: event.venue.street ?? '',
    postcode: event.venue.postcode ?? '',
    city: event.venue.city ?? '',
    country: event.venue.country ?? '',
    tin: event.venue.tin ?? '',
    localCurrency: event.localCurrency ?? '',
    exchangeRate: event.exchangeRate != null ? String(event.exchangeRate) : '',
    roundingIncrement: String(event.roundingIncrement ?? 0),
    copyStockFrom: '',
  });
  fetchRateError.value = '';
  editingId.value = event.id;
}

async function saveEdit(): Promise<void> {
  const event = data.events.find((e) => e.id === editingId.value);
  if (!event || !form.name.trim()) return;
  const localCurrency = form.localCurrency.trim().toUpperCase();
  const rate = parseFloat(form.exchangeRate);
  await upsertEvent({
    ...event,
    name: form.name.trim(),
    dateStart: form.dateStart || undefined,
    dateEnd: form.dateEnd || undefined,
    venue: {
      street: form.street || undefined,
      postcode: form.postcode || undefined,
      city: form.city || undefined,
      country: form.country || undefined,
      tin: form.tin || undefined,
    },
    currency: settings.defaultCurrency,
    localCurrency: localCurrency && Number.isFinite(rate) && rate > 0 ? localCurrency : undefined,
    exchangeRate: localCurrency && Number.isFinite(rate) && rate > 0 ? rate : undefined,
    roundingIncrement: Number(form.roundingIncrement) || 0,
    updatedAt: Date.now(),
  });
  editingId.value = null;
}

async function doClose(eventId: string): Promise<void> {
  const event = data.events.find((e) => e.id === eventId);
  const end = event?.dateEnd || event?.dateStart;
  const today = new Date().toISOString().slice(0, 10);
  // Closing an event that hasn't happened yet just parks it back to "planned"
  // rather than finalising it as closed.
  if (event && end && end > today) {
    await upsertEvent({ ...event, status: 'planned', updatedAt: Date.now() });
  } else {
    await closeEvent(eventId);
  }
  if (settings.activeEventId === eventId) await settings.setActiveEvent(null);
  confirmCloseId.value = null;
}

async function doDelete(eventId: string): Promise<void> {
  const event = data.events.find((e) => e.id === eventId);
  if (event && event.status !== 'closed') {
    confirmDeleteId.value = null;
    return; // only closed events can be deleted (button is hidden otherwise)
  }
  await deleteEvent(eventId);
  if (settings.activeEventId === eventId) await settings.setActiveEvent(null);
  confirmDeleteId.value = null;
}

function fmtDates(e: SalesEvent): string {
  if (e.dateStart && e.dateEnd) return `${e.dateStart} → ${e.dateEnd}`;
  return e.dateStart || '';
}
</script>

<template>
  <div class="mx-auto max-w-3xl p-4 md:p-6 xl:max-w-6xl">
    <div class="mb-5 flex items-center justify-between">
      <h1 class="text-xl font-bold">Events</h1>
      <button
        class="zui-btn zui-btn-primary"
        @click="openCreate"
      >
        + New event
      </button>
    </div>

    <p v-if="!hasAnyEvent" class="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400">
      No events yet. Create one to start selling — every sale is recorded against the active event.
    </p>

    <!-- Upcoming/active first (chronological), then a separate Finished section. -->
    <template v-for="group in eventGroups" :key="group.label || 'upcoming'">
      <h3 v-if="group.label && group.events.length" class="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {{ group.label }}
      </h3>
      <ul v-if="group.events.length" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <li
          v-for="event in group.events"
          :key="event.id"
          class="rounded-xl bg-slate-900 p-4 ring-1"
          :class="event.id === settings.activeEventId ? 'ring-emerald-500' : 'ring-slate-800'"
        >
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-base font-semibold">{{ event.name }}</span>
          <span
            class="rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide"
            :class="{
              'bg-emerald-950 text-emerald-400': event.status === 'active',
              'bg-sky-950 text-sky-400': event.status === 'planned',
              'bg-slate-800 text-slate-400': event.status === 'closed',
            }"
          >
            {{ event.id === settings.activeEventId ? 'selling' : event.status }}
          </span>
        </div>
        <p class="mt-1 text-xs text-slate-400">
          {{ fmtDates(event) }}<span v-if="event.venue.city"> · {{ event.venue.city }}</span>
        </p>
        <p class="mt-2 text-sm text-slate-300">
          {{ eventStats(event.id).count }} sales ·
          {{ fmtPrice(eventStats(event.id).revenue, eventStats(event.id).currency) }}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <!-- Planned events "Open" (go active); active events "Sell" (go to POS). -->
          <button
            v-if="event.status === 'planned'"
            class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            @click="activate(event)"
          >
            <span class="flex items-center gap-1.5"><DoorOpen class="h-3.5 w-3.5" /> Open</span>
          </button>
          <button
            v-if="event.status === 'active'"
            class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            @click="sell(event)"
          >
            <span class="flex items-center gap-1.5"><ShoppingCart class="h-3.5 w-3.5" /> Sell</span>
          </button>
          <button
            v-if="event.status === 'closed'"
            class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            @click="activate(event)"
          >
            Reopen
          </button>
          <RouterLink
            :to="{ path: '/history', query: { event: event.id } }"
            class="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            <ChartLine class="h-3.5 w-3.5" /> History
          </RouterLink>
          <RouterLink
            :to="`/customs/${event.id}`"
            class="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            <Stamp class="h-3.5 w-3.5" /> Customs
          </RouterLink>
          <RouterLink
            v-if="event.localCurrency"
            :to="`/prices/${event.id}`"
            class="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            <ArrowLeftRight class="h-3.5 w-3.5" /> Prices
          </RouterLink>
          <button
            class="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
            @click="openEdit(event)"
          >
            <Pencil class="h-3.5 w-3.5" /> Edit
          </button>
          <button
            v-if="event.status !== 'closed'"
            class="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-800"
            @click="confirmCloseId = event.id"
          >
            Close
          </button>
          <!-- Deleting is a two-step act on purpose: close the event first, then delete. -->
          <button
            v-if="event.status === 'closed'"
            class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-red-400/80 hover:bg-red-950 hover:text-red-400"
            @click="confirmDeleteId = event.id"
          >
            <Trash2 class="h-3.5 w-3.5" /> Delete
          </button>
        </div>
        </li>
      </ul>
    </template>

    <!-- Create / edit modal -->
    <ModalShell
      v-if="showCreate || editingId"
      :title="editingId ? 'Edit event' : 'New event'"
      @close="
        showCreate = false;
        editingId = null;
      "
    >
      <div class="space-y-3">
        <label v-if="!editingId" class="block text-sm">
          <span class="text-slate-400">From preset</span>
          <select
            v-model="form.preset"
            class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
            @change="applyPreset"
          >
            <option value="">— blank —</option>
            <option v-for="p in EVENT_PRESETS" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Name *</span>
          <input v-model="form.name" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Dates</span>
          <DateRangePicker
            v-model:start="form.dateStart"
            v-model:end="form.dateEnd"
            class="mt-1"
          />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-sm">
            <span class="text-slate-400">Street</span>
            <input v-model="form.street" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-slate-400">City</span>
            <input v-model="form.city" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <label class="block text-sm">
            <span class="text-slate-400">Postcode</span>
            <input v-model="form.postcode" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-slate-400">Country</span>
            <CountryPicker v-model="form.country" mode="name" class="mt-1" />
          </label>
        </div>

        <div class="rounded-lg bg-slate-800/40 p-3 ring-1 ring-slate-800">
          <p class="mb-2 text-xs font-medium text-slate-400">
            Local currency (optional) — display and charge prices converted from your base currency
            ({{ settings.defaultCurrency }}), leave blank to sell in {{ settings.defaultCurrency }} directly.
          </p>
          <div class="grid grid-cols-3 gap-3">
            <label class="block text-sm">
              <span class="text-slate-400">Local currency</span>
              <CurrencyPicker v-model="form.localCurrency" placeholder="Search…" class="mt-1" />
            </label>
            <label class="block text-sm">
              <span class="text-slate-400">Rate (1 {{ settings.defaultCurrency }} =)</span>
              <input
                v-model="form.exchangeRate"
                type="number"
                min="0"
                step="0.0001"
                inputmode="decimal"
                class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
              />
            </label>
            <label class="block text-sm">
              <span class="text-slate-400">Round to nearest</span>
              <select v-model="form.roundingIncrement" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2">
                <option v-for="[value, label] in ROUNDING_INCREMENTS" :key="value" :value="value">{{ label }}</option>
              </select>
            </label>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <button
              type="button"
              class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700 disabled:opacity-40"
              :disabled="!settings.defaultCurrency.trim() || !form.localCurrency.trim() || fetchingRate"
              @click="fetchRate"
            >
              {{ fetchingRate ? 'Fetching…' : "Fetch today's rate" }}
            </button>
            <span v-if="fetchRateError" class="text-xs text-amber-400">{{ fetchRateError }}</span>
          </div>
        </div>

        <label v-if="!editingId" class="block text-sm">
          <span class="text-slate-400">Copy stock from</span>
          <select v-model="form.copyStockFrom" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2">
            <option value="">— don't copy —</option>
            <option v-for="e in data.events" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
        </label>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button
            class="rounded-lg bg-slate-800 px-4 py-2 text-sm"
            @click="
              showCreate = false;
              editingId = null;
            "
          >
            Cancel
          </button>
          <button
            class="zui-btn zui-btn-primary"
            :disabled="!form.name.trim()"
            @click="editingId ? saveEdit() : createEvent()"
          >
            {{ editingId ? 'Save' : 'Create' }}
          </button>
        </div>
      </template>
    </ModalShell>

    <!-- Delete confirm -->
    <ModalShell v-if="confirmDeleteId" title="Delete event?" @close="confirmDeleteId = null">
      <p class="text-sm text-slate-300">
        The event disappears from this list and from all connected devices. Recorded sales are kept
        — they stay visible in History under “(deleted event)” — but the event itself, its stock
        counts and customs data are no longer reachable.
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm" @click="confirmDeleteId = null">Cancel</button>
          <button
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
            @click="doDelete(confirmDeleteId!)"
          >
            Delete event
          </button>
        </div>
      </template>
    </ModalShell>

    <!-- Close confirm -->
    <ModalShell v-if="confirmCloseId" title="Close event?" @close="confirmCloseId = null">
      <p class="text-sm text-slate-300">
        Closing stops sales for this event. Nothing is deleted — history, stats and exports stay
        available, and you can reopen it any time.
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm" @click="confirmCloseId = null">Cancel</button>
          <button
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
            @click="doClose(confirmCloseId!)"
          >
            Close event
          </button>
        </div>
      </template>
    </ModalShell>
  </div>
</template>
