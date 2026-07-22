<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useDataStore, stockKey } from '@/stores/data';
import { upsertEvent } from '@/db/repo';
import { fmtPrice, round2, toLocalPrice } from '@/lib/money';
import { showToast } from '@/lib/toast';

const data = useDataStore();
const route = useRoute();

/** The event this page belongs to: route param first, active event as fallback. */
const currentEvent = computed(
  () => data.events.find((e) => e.id === route.params.eventId) ?? data.activeEvent,
);

const hasLocal = computed(
  () => !!currentEvent.value?.localCurrency && (currentEvent.value?.exchangeRate ?? 0) > 0,
);

interface Row {
  key: string;
  pid: string;
  vid: string | null;
  title: string;
  base: number;
  converted: number;
  autoRounded: number;
  effective: number;
  backConverted: number;
  drift: number;
}

function buildRows(): Row[] {
  const event = currentEvent.value;
  if (!event || !hasLocal.value) return [];
  const rate = event.exchangeRate!;
  const increment = event.roundingIncrement ?? 0;
  const overrides = event.localPriceOverrides ?? {};

  function toRow(pid: string, vid: string | null, title: string, base: number): Row {
    const key = stockKey(pid, vid);
    const converted = round2(base * rate);
    const autoRounded = toLocalPrice(base, rate, increment);
    const override = overrides[key];
    const effective = override ?? autoRounded;
    const backConverted = round2(effective / rate);
    return { key, pid, vid, title, base, converted, autoRounded, effective, backConverted, drift: round2(backConverted - base) };
  }

  const rows: Row[] = [];
  for (const p of data.products) {
    if (p.deletedAt) continue;
    if (p.variants.length) {
      for (const v of p.variants) {
        rows.push(toRow(p.id, v.id, v.name ? `${p.title} · ${v.name}` : p.title, v.price ?? p.price));
      }
    } else {
      rows.push(toRow(p.id, null, p.title, p.price));
    }
  }
  return rows;
}

const searchTerm = ref('');
const sortByDrift = ref(true);

const rows = computed(() => {
  const needle = searchTerm.value.trim().toLowerCase();
  let list = buildRows();
  if (needle) list = list.filter((r) => r.title.toLowerCase().includes(needle));
  return [...list].sort((a, b) =>
    sortByDrift.value ? Math.abs(b.drift) - Math.abs(a.drift) : a.title.localeCompare(b.title),
  );
});

// ── Editable override drafts, one text input per row ────────────────────────
const drafts = reactive<Record<string, string>>({});

watch(
  () => currentEvent.value?.id,
  () => {
    for (const k of Object.keys(drafts)) delete drafts[k];
    const overrides = currentEvent.value?.localPriceOverrides ?? {};
    for (const [k, v] of Object.entries(overrides)) drafts[k] = String(v);
  },
  { immediate: true },
);

async function saveOverride(row: Row): Promise<void> {
  const event = currentEvent.value;
  if (!event) return;
  const raw = drafts[row.key]?.trim() ?? '';
  const overrides = { ...(event.localPriceOverrides ?? {}) };
  if (!raw) {
    delete overrides[row.key];
  } else {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) {
      showToast('Enter a positive price, or leave blank to use the auto-rounded price.', 'error');
      drafts[row.key] = event.localPriceOverrides?.[row.key] != null ? String(event.localPriceOverrides[row.key]) : '';
      return;
    }
    overrides[row.key] = n;
  }
  await upsertEvent({ ...event, localPriceOverrides: overrides, updatedAt: Date.now() });
}

function clearOverride(row: Row): void {
  drafts[row.key] = '';
  void saveOverride(row);
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink to="/events" class="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800">←</RouterLink>
      <h1 class="text-xl font-bold">Price compare</h1>
      <span v-if="currentEvent" class="text-sm text-slate-400">{{ currentEvent.name }}</span>
    </div>

    <p v-if="!currentEvent" class="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400">
      Event not found — open Price compare from an event card under Events.
    </p>
    <p v-else-if="!hasLocal" class="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400">
      This event has no convention currency set — edit the event to set a local currency and rate first.
    </p>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="searchTerm"
          placeholder="Search products…"
          class="min-w-0 flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm"
        />
        <button
          class="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700"
          @click="sortByDrift = !sortByDrift"
        >
          Sort: {{ sortByDrift ? 'Biggest rounding drift' : 'A–Z' }}
        </button>
      </div>

      <div class="overflow-x-auto rounded-xl bg-slate-900 ring-1 ring-slate-800">
        <table class="w-full min-w-[820px] text-sm">
          <thead>
            <tr class="border-b border-slate-800 text-left text-xs text-slate-400">
              <th class="px-3 py-2">Product</th>
              <th class="px-3 py-2 text-right">Base ({{ currentEvent.currency }})</th>
              <th class="px-3 py-2 text-right">Converted</th>
              <th class="px-3 py-2 text-right">Auto-rounded ({{ currentEvent.localCurrency }})</th>
              <th class="px-3 py-2 text-right">Override</th>
              <th class="px-3 py-2 text-right">Back to {{ currentEvent.currency }}</th>
              <th class="px-3 py-2 text-right">Drift</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in rows"
              :key="r.key"
              class="border-b border-slate-800/60 last:border-0"
              :class="drafts[r.key] ? 'bg-emerald-950/20' : ''"
            >
              <td class="px-3 py-2">{{ r.title }}</td>
              <td class="px-3 py-2 text-right text-slate-400">{{ fmtPrice(r.base, currentEvent.currency) }}</td>
              <td class="px-3 py-2 text-right text-slate-500">{{ fmtPrice(r.converted, currentEvent.localCurrency!) }}</td>
              <td class="px-3 py-2 text-right">{{ fmtPrice(r.autoRounded, currentEvent.localCurrency!) }}</td>
              <td class="px-3 py-2 text-right">
                <div class="flex items-center justify-end gap-1">
                  <input
                    v-model="drafts[r.key]"
                    :placeholder="String(r.autoRounded)"
                    inputmode="decimal"
                    class="w-20 rounded-md bg-slate-800 px-2 py-1 text-right text-sm"
                    @change="saveOverride(r)"
                  />
                  <button
                    v-if="drafts[r.key]"
                    class="text-xs text-slate-500 hover:text-red-400"
                    title="Clear override"
                    @click="clearOverride(r)"
                  >
                    ×
                  </button>
                </div>
              </td>
              <td class="px-3 py-2 text-right text-slate-400">{{ fmtPrice(r.backConverted, currentEvent.currency) }}</td>
              <td
                class="px-3 py-2 text-right font-medium"
                :class="Math.abs(r.drift) < 0.005 ? 'text-slate-600' : Math.abs(r.drift) < 0.5 ? 'text-amber-400' : 'text-red-400'"
              >
                {{ r.drift > 0 ? '+' : '' }}{{ fmtPrice(r.drift, currentEvent.currency) }}
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!rows.length" class="p-6 text-center text-sm text-slate-500">No products match.</p>
      </div>

      <p class="text-xs text-slate-500">
        "Converted" is the raw exchange-rate conversion before rounding. "Auto-rounded" is what's
        shown/charged by default. Set an override to charge a specific {{ currentEvent.localCurrency }}
        price instead — "Back to {{ currentEvent.currency }}" and "Drift" show what that's actually
        worth in your tracking currency, so you can spot prices that rounded away too much value.
      </p>
    </template>
  </div>
</template>
