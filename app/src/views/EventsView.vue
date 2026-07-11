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
import { EVENT_PRESETS } from '@/data/event-presets';
import ModalShell from '@/components/ModalShell.vue';
import CountryPicker from '@/components/CountryPicker.vue';

const data = useDataStore();
const settings = useSettingsStore();
const router = useRouter();

const showCreate = ref(false);
const editingId = ref<string | null>(null);
const confirmCloseId = ref<string | null>(null);
const confirmDeleteId = ref<string | null>(null);

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
  currency: 'CHF',
  copyStockFrom: '',
});

const statusOrder: Record<string, number> = { active: 0, planned: 1, closed: 2 };
const sortedEvents = computed(() =>
  [...data.events].sort(
    (a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3) || b.updatedAt - a.updatedAt,
  ),
);

function eventStats(eventId: string): { count: number; revenue: number; currency: string } {
  let count = 0;
  let revenue = 0;
  let currency = 'CHF';
  for (const tx of data.allTransactions) {
    if (tx.eventId !== eventId || tx.revertedBy) continue;
    count++;
    revenue += tx.total;
    currency = tx.currency;
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
  form.currency = preset.currency;
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
    currency: settings.defaultCurrency,
    copyStockFrom: '',
  });
  showCreate.value = true;
}

async function createEvent(): Promise<void> {
  if (!form.name.trim()) return;
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
    currency: form.currency || 'CHF',
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
    currency: event.currency,
    copyStockFrom: '',
  });
  editingId.value = event.id;
}

async function saveEdit(): Promise<void> {
  const event = data.events.find((e) => e.id === editingId.value);
  if (!event || !form.name.trim()) return;
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
    currency: form.currency || 'CHF',
    updatedAt: Date.now(),
  });
  editingId.value = null;
}

async function doClose(eventId: string): Promise<void> {
  await closeEvent(eventId);
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
  <div class="mx-auto max-w-3xl p-4 md:p-6">
    <div class="mb-5 flex items-center justify-between">
      <h1 class="text-xl font-bold">Events</h1>
      <button
        class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        @click="openCreate"
      >
        + New event
      </button>
    </div>

    <p v-if="!sortedEvents.length" class="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400">
      No events yet. Create one to start selling — every sale is recorded against the active event.
    </p>

    <ul class="space-y-3">
      <li
        v-for="event in sortedEvents"
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
          <button
            v-if="event.status !== 'closed'"
            class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            @click="sell(event)"
          >
            🛒 Sell
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
            class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            📈 History
          </RouterLink>
          <RouterLink
            :to="`/customs/${event.id}`"
            class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            🛃 Customs
          </RouterLink>
          <button
            class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
            @click="openEdit(event)"
          >
            ✏️ Edit
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
            class="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-400/80 hover:bg-red-950 hover:text-red-400"
            @click="confirmDeleteId = event.id"
          >
            🗑 Delete
          </button>
        </div>
      </li>
    </ul>

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
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-sm">
            <span class="text-slate-400">Start</span>
            <input v-model="form.dateStart" type="date" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-slate-400">End</span>
            <input v-model="form.dateEnd" type="date" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
        </div>
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
          <label class="block text-sm">
            <span class="text-slate-400">Currency</span>
            <input v-model="form.currency" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
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
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
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
