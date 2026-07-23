<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useDataStore, stockKey } from '@/stores/data';
import { upsertEvent } from '@/db/repo';
import { fmtPrice, round2, toLocalPrice } from '@/lib/money';
import { showToast } from '@/lib/toast';
import { typeColor } from '@/lib/search';

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
  /** Every stockKey an override on this row should apply to — >1 for a collapsed same-price variant group. */
  memberKeys: string[];
  pid: string;
  vid: string | null;
  type: string;
  title: string;
  /** Whether to render the expand/collapse control on this row. */
  showToggle: boolean;
  /** Whether the group is currently shown expanded (controls the toggle's label/arrow). */
  expanded: boolean;
  variantCount: number;
  base: number;
  converted: number;
  autoRounded: number;
  effective: number;
  backConverted: number;
  drift: number;
}

/** Products expanded to show each variant individually, overriding the same-price auto-collapse. */
const expandedProducts = ref<Set<string>>(new Set());

function toggleExpanded(pid: string): void {
  const next = new Set(expandedProducts.value);
  if (next.has(pid)) next.delete(pid);
  else next.add(pid);
  expandedProducts.value = next;
}

function buildRows(): Row[] {
  const event = currentEvent.value;
  if (!event || !hasLocal.value) return [];
  const rate = event.exchangeRate!;
  const increment = event.roundingIncrement ?? 0;
  const overrides = event.localPriceOverrides ?? {};

  function toRow(
    pid: string,
    vid: string | null,
    type: string,
    title: string,
    base: number,
    memberKeys: string[],
    variantCount: number,
    showToggle: boolean,
    expanded: boolean,
  ): Row {
    const key = memberKeys[0]!;
    const converted = round2(base * rate);
    const autoRounded = toLocalPrice(base, rate, increment);
    // A collapsed group only has one "effective" price when every member shares the same
    // override (or none do) — if they've since diverged, fall back to the auto-rounded price
    // rather than showing one variant's override as if it applied to the whole group.
    const memberOverrides = memberKeys.map((k) => overrides[k]);
    const override =
      memberOverrides.every((o) => o === memberOverrides[0]) ? memberOverrides[0] : undefined;
    const effective = override ?? autoRounded;
    const backConverted = round2(effective / rate);
    return {
      key,
      memberKeys,
      pid,
      vid,
      type,
      title,
      showToggle,
      expanded,
      variantCount,
      base,
      converted,
      autoRounded,
      effective,
      backConverted,
      drift: round2(backConverted - base),
    };
  }

  const rows: Row[] = [];
  for (const p of data.products) {
    if (p.deletedAt) continue;
    const type = p.type?.trim() || 'Other';
    if (p.variants.length) {
      const prices = p.variants.map((v) => v.price ?? p.price);
      const allSamePrice = prices.every((pr) => pr === prices[0]);
      if (allSamePrice && !expandedProducts.value.has(p.id)) {
        rows.push(
          toRow(
            p.id,
            null,
            type,
            p.title,
            prices[0]!,
            p.variants.map((v) => stockKey(p.id, v.id)),
            p.variants.length,
            true,
            false,
          ),
        );
      } else {
        p.variants.forEach((v, i) => {
          rows.push(
            toRow(
              p.id,
              v.id,
              type,
              v.name ? `${p.title} · ${v.name}` : p.title,
              v.price ?? p.price,
              [stockKey(p.id, v.id)],
              p.variants.length,
              allSamePrice && i === 0,
              true,
            ),
          );
        });
      }
    } else {
      rows.push(toRow(p.id, null, type, p.title, p.price, [stockKey(p.id, null)], 1, false, false));
    }
  }
  return rows;
}

// ── Tiered-discount bundle totals ("3 for 10 CHF") ──────────────────────────
interface TierRow {
  key: string;
  ruleId: string;
  ruleName: string;
  qty: number;
  base: number;
  converted: number;
  autoRounded: number;
  effective: number;
  backConverted: number;
  drift: number;
}

function buildTierRows(): TierRow[] {
  const event = currentEvent.value;
  if (!event || !hasLocal.value) return [];
  const rate = event.exchangeRate!;
  const increment = event.roundingIncrement ?? 0;
  const overrides = event.localTierOverrides ?? {};

  const rows: TierRow[] = [];
  for (const rule of data.discounts) {
    if (rule.type !== 'tiered' || !rule.tiers?.length) continue;
    rule.tiers.forEach((t, i) => {
      const key = `${rule.id}:${i}`;
      const converted = round2(t.total * rate);
      const autoRounded = toLocalPrice(t.total, rate, increment);
      const override = overrides[key];
      const effective = override ?? autoRounded;
      const backConverted = round2(effective / rate);
      rows.push({
        key,
        ruleId: rule.id,
        ruleName: rule.name,
        qty: t.qty,
        base: t.total,
        converted,
        autoRounded,
        effective,
        backConverted,
        drift: round2(backConverted - t.total),
      });
    });
  }
  return rows;
}

const searchTerm = ref('');
const sortByDrift = ref(true);

const rows = computed(() => {
  const needle = searchTerm.value.trim().toLowerCase();
  let list = buildRows();
  if (needle) list = list.filter((r) => r.title.toLowerCase().includes(needle));
  return list;
});

/** Rows grouped by product type, matching the Catalog page; sorted within each group. */
const typeGroups = computed(() => {
  const groups = new Map<string, Row[]>();
  for (const r of rows.value) {
    const list = groups.get(r.type) ?? [];
    list.push(r);
    groups.set(r.type, list);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, groupRows]) => ({
      type,
      rows: [...groupRows].sort((a, b) =>
        sortByDrift.value ? Math.abs(b.drift) - Math.abs(a.drift) : a.title.localeCompare(b.title),
      ),
    }));
});

const tierRows = computed(() => buildTierRows());

/** Tier rows grouped by their parent discount rule, tiers sorted by qty within each. */
const ruleGroups = computed(() => {
  const groups = new Map<string, TierRow[]>();
  for (const r of tierRows.value) {
    const list = groups.get(r.ruleId) ?? [];
    list.push(r);
    groups.set(r.ruleId, list);
  }
  const entries = [...groups.entries()].map(([ruleId, groupRows]) => ({
    ruleId,
    ruleName: groupRows[0]!.ruleName,
    maxDrift: Math.max(...groupRows.map((r) => Math.abs(r.drift))),
    rows: [...groupRows].sort((a, b) => a.qty - b.qty),
  }));
  return entries.sort((a, b) =>
    sortByDrift.value ? b.maxDrift - a.maxDrift : a.ruleName.localeCompare(b.ruleName),
  );
});

// ── Editable override drafts, one text input per row ────────────────────────
const drafts = reactive<Record<string, string>>({});
const tierDrafts = reactive<Record<string, string>>({});

watch(
  () => currentEvent.value?.id,
  () => {
    for (const k of Object.keys(drafts)) delete drafts[k];
    for (const [k, v] of Object.entries(currentEvent.value?.localPriceOverrides ?? {})) drafts[k] = String(v);
    for (const k of Object.keys(tierDrafts)) delete tierDrafts[k];
    for (const [k, v] of Object.entries(currentEvent.value?.localTierOverrides ?? {})) tierDrafts[k] = String(v);
  },
  { immediate: true },
);

async function saveOverride(row: Row): Promise<void> {
  const event = currentEvent.value;
  if (!event) return;
  const raw = drafts[row.key]?.trim() ?? '';
  const overrides = { ...(event.localPriceOverrides ?? {}) };
  if (!raw) {
    for (const k of row.memberKeys) delete overrides[k];
  } else {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) {
      showToast('Enter a positive price, or leave blank to use the auto-rounded price.', 'error');
      drafts[row.key] = event.localPriceOverrides?.[row.key] != null ? String(event.localPriceOverrides[row.key]) : '';
      return;
    }
    // A collapsed row represents every same-priced variant — override applies to all of them.
    for (const k of row.memberKeys) overrides[k] = n;
  }
  await upsertEvent({ ...event, localPriceOverrides: overrides, updatedAt: Date.now() });
}

function clearOverride(row: Row): void {
  drafts[row.key] = '';
  void saveOverride(row);
}

async function saveTierOverride(row: TierRow): Promise<void> {
  const event = currentEvent.value;
  if (!event) return;
  const raw = tierDrafts[row.key]?.trim() ?? '';
  const overrides = { ...(event.localTierOverrides ?? {}) };
  if (!raw) {
    delete overrides[row.key];
  } else {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) {
      showToast('Enter a positive price, or leave blank to use the auto-rounded price.', 'error');
      tierDrafts[row.key] = event.localTierOverrides?.[row.key] != null ? String(event.localTierOverrides[row.key]) : '';
      return;
    }
    overrides[row.key] = n;
  }
  await upsertEvent({ ...event, localTierOverrides: overrides, updatedAt: Date.now() });
}

function clearTierOverride(row: TierRow): void {
  tierDrafts[row.key] = '';
  void saveTierOverride(row);
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

      <div v-for="group in typeGroups" :key="group.type" class="space-y-2">
        <div class="flex items-center gap-2">
          <span class="h-4 w-1.5 rounded-full" :style="{ background: typeColor(group.type) }" />
          <h2 class="text-sm font-semibold" :style="{ color: typeColor(group.type) }">{{ group.type }}</h2>
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
                v-for="r in group.rows"
                :key="r.key"
                class="border-b border-slate-800/60 last:border-0"
                :class="drafts[r.key] ? 'bg-emerald-950/20' : ''"
              >
                <td class="px-3 py-2">
                  <button
                    v-if="r.showToggle"
                    class="flex items-center gap-1 hover:text-emerald-400"
                    @click="toggleExpanded(r.pid)"
                  >
                    <span class="text-slate-500">{{ r.expanded ? '▾' : '▸' }}</span>
                    {{ r.title }}
                    <span class="text-xs text-slate-500">{{ r.expanded ? 'collapse' : `(${r.variantCount} variants)` }}</span>
                  </button>
                  <span v-else>{{ r.title }}</span>
                </td>
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
        </div>
      </div>
      <p v-if="!rows.length" class="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-500">No products match.</p>

      <p class="text-xs text-slate-500">
        "Converted" is the raw exchange-rate conversion before rounding. "Auto-rounded" is what's
        shown/charged by default. Set an override to charge a specific {{ currentEvent.localCurrency }}
        price instead — "Back to {{ currentEvent.currency }}" and "Drift" show what that's actually
        worth in your tracking currency, so you can spot prices that rounded away too much value.
      </p>

      <template v-if="tierRows.length">
        <h2 class="text-sm font-semibold text-slate-300">Tiered discount bundles</h2>
        <div v-for="group in ruleGroups" :key="group.ruleId" class="space-y-2">
          <h3 class="text-xs font-semibold text-slate-400">{{ group.ruleName }}</h3>
          <div class="overflow-x-auto rounded-xl bg-slate-900 ring-1 ring-slate-800">
            <table class="w-full min-w-[820px] text-sm">
              <thead>
                <tr class="border-b border-slate-800 text-left text-xs text-slate-400">
                  <th class="px-3 py-2">Bundle</th>
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
                  v-for="r in group.rows"
                  :key="r.key"
                  class="border-b border-slate-800/60 last:border-0"
                  :class="tierDrafts[r.key] ? 'bg-emerald-950/20' : ''"
                >
                  <td class="px-3 py-2">{{ r.qty }}×</td>
                  <td class="px-3 py-2 text-right text-slate-400">{{ fmtPrice(r.base, currentEvent.currency) }}</td>
                  <td class="px-3 py-2 text-right text-slate-500">{{ fmtPrice(r.converted, currentEvent.localCurrency!) }}</td>
                  <td class="px-3 py-2 text-right">{{ fmtPrice(r.autoRounded, currentEvent.localCurrency!) }}</td>
                  <td class="px-3 py-2 text-right">
                    <div class="flex items-center justify-end gap-1">
                      <input
                        v-model="tierDrafts[r.key]"
                        :placeholder="String(r.autoRounded)"
                        inputmode="decimal"
                        class="w-20 rounded-md bg-slate-800 px-2 py-1 text-right text-sm"
                        @change="saveTierOverride(r)"
                      />
                      <button
                        v-if="tierDrafts[r.key]"
                        class="text-xs text-slate-500 hover:text-red-400"
                        title="Clear override"
                        @click="clearTierOverride(r)"
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
          </div>
        </div>
        <p class="text-xs text-slate-500">
          Bundle totals (e.g. "3 for 10 CHF") convert and round the same way as product prices, and
          can be overridden the same way. The discount actually charged at checkout is computed
          directly against this local bundle total, not by converting the base-currency discount
          amount — so an override here lands exactly at checkout.
        </p>
      </template>
    </template>
  </div>
</template>
