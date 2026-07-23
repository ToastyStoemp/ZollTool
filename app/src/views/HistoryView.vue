<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { Transaction, TxDiscount, TxItem } from '@zolltool/shared';
import { useDataStore } from '@/stores/data';
import { getSetting, revertTransaction, setSyncedSetting } from '@/db/repo';
import { fmtPrice, round2 } from '@/lib/money';
import { transactionsToCsv } from '@/lib/export/csv';
import { typeColor } from '@/lib/search';
import { saveBinaryFile, saveTextFile } from '@/lib/download';
import { showToast } from '@/lib/toast';
import {
  buildReceiptLines,
  loadReceiptConfig,
  printReceipt as printReceiptLines,
  printingAvailable,
  type ReceiptLine,
} from '@/lib/receipt';
import { ArrowLeft, Banknote, CreditCard, Printer, Smartphone, Zap } from 'lucide-vue-next';
import type { Component } from 'vue';
import ModalShell from '@/components/ModalShell.vue';

const data = useDataStore();
const route = useRoute();

/** Opened from the POS header — show a shortcut back to selling. */
const fromPos = route.query.from === 'pos';

// ── Scope: one event or all events ──────────────────────────────────────────
const scope = ref<string>(
  typeof route.query.event === 'string' ? route.query.event : (data.activeEvent?.id ?? 'all'),
);
const scopeEvent = computed(() =>
  scope.value === 'all' ? null : (data.events.find((e) => e.id === scope.value) ?? null),
);
const allMode = computed(() => scope.value === 'all');

const scopedTransactions = computed(() => {
  const list = allMode.value
    ? data.allTransactions
    : data.allTransactions.filter((t) => t.eventId === scope.value);
  return [...list].sort((a, b) => b.timestamp - a.timestamp);
});

/** Charge/local currency for the scope — what was physically collected (cash drawer, card terminal). */
const currency = computed(() => scopeEvent.value?.localCurrency || scopeEvent.value?.currency || data.currency);

function eventName(eventId: string): string {
  return data.events.find((e) => e.id === eventId)?.name ?? '(deleted event)';
}

// ── Local / base currency toggle ────────────────────────────────────────────
// Only shown when at least one transaction in scope was charged in a
// converted local currency (i.e. this feature was actually used). Applies to
// revenue-style figures (what did I sell); cash/card/drawer reconciliation
// always stays in whatever was physically collected.
type AmountView = 'local' | 'base';
const amountView = ref<AmountView>('local');
const hasBaseData = computed(() => scopedTransactions.value.some((t) => t.baseCurrency));

const revenueCurrency = computed(() =>
  amountView.value === 'base' ? (scopeEvent.value?.currency ?? data.currency) : currency.value,
);

function amountOf(tx: Transaction): number {
  return amountView.value === 'base' && tx.baseTotal != null ? tx.baseTotal : tx.total;
}
function currencyOf(tx: Transaction): string {
  return amountView.value === 'base' ? (tx.baseCurrency ?? tx.currency) : tx.currency;
}
function itemAmountOf(item: TxItem): number {
  return amountView.value === 'base' && item.baseLineTotal != null ? item.baseLineTotal : item.lineTotal;
}
function discountAmountOf(d: TxDiscount, tx: Transaction): number {
  if (amountView.value !== 'base' || !tx.exchangeRate) return d.amount;
  return round2(d.amount / tx.exchangeRate);
}

const methodFilter = ref<string>('all');
const showReverted = ref(false);
const revertId = ref<string | null>(null);

/** Built-in methods plus any custom ones that actually occur in this scope. */
const methodOptions = computed(() => {
  const extras = new Set<string>();
  for (const tx of scopedTransactions.value) {
    if (!['cash', 'card', 'split'].includes(tx.method)) extras.add(tx.method);
  }
  return ['all', 'cash', 'card', 'split', ...extras];
});

const visible = computed(() =>
  scopedTransactions.value.filter((tx) => {
    if (!showReverted.value && tx.revertedBy) return false;
    if (methodFilter.value !== 'all' && tx.method !== methodFilter.value) return false;
    return true;
  }),
);

const stats = computed(() => {
  const active = scopedTransactions.value.filter((t) => !t.revertedBy);
  const revenue = active.reduce((s, t) => s + amountOf(t), 0);
  const items = active.reduce((s, t) => s + t.items.reduce((si, i) => si + i.qty, 0), 0);
  const cash = active.reduce(
    (s, t) => s + t.payments.filter((p) => p.kind === 'cash').reduce((sp, p) => sp + p.amount, 0),
    0,
  );
  const card = active.reduce(
    (s, t) => s + t.payments.filter((p) => p.kind === 'card').reduce((sp, p) => sp + p.amount, 0),
    0,
  );
  return { count: active.length, revenue, items, cash, card };
});

// ── Best sellers: by product or type, sorted by qty or revenue ──────────────
type BestMode = 'products' | 'types' | 'revenue' | 'revenueByType';
const bestMode = ref<BestMode>('products');
const bestExpanded = ref(false);
const bestModes: Array<{ id: BestMode; label: string }> = [
  { id: 'products', label: 'Products' },
  { id: 'types', label: 'Types' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'revenueByType', label: 'Revenue by type' },
];

/** pid → product type, resolved from the catalog (sold items don't store it). */
const typeByPid = computed(() => {
  const map = new Map<string, string>();
  for (const p of data.products) if (p.type) map.set(p.id, p.type);
  return map;
});

const bestAll = computed(() => {
  const map = new Map<string, { label: string; type?: string; qty: number; value: number }>();
  const byType = bestMode.value === 'types' || bestMode.value === 'revenueByType';
  const byRevenue = bestMode.value === 'revenue' || bestMode.value === 'revenueByType';
  for (const tx of scopedTransactions.value) {
    if (tx.revertedBy) continue;
    for (const item of tx.items) {
      let key: string;
      let label: string;
      let type: string | undefined;
      if (byType) {
        key = label = typeByPid.value.get(item.pid) ?? '(no type)';
        type = key;
      } else {
        key = `${item.pid}:${item.vid ?? ''}`;
        label = item.variantLabel ? `${item.title} · ${item.variantLabel}` : item.title;
      }
      const cur = map.get(key) ?? { label, type, qty: 0, value: 0 };
      cur.qty += item.qty;
      cur.value += itemAmountOf(item);
      map.set(key, cur);
    }
  }
  const list = [...map.values()];
  list.sort(byRevenue ? (a, b) => b.value - a.value : (a, b) => b.qty - a.qty);
  return list;
});

const bestSellers = computed(() => (bestExpanded.value ? bestAll.value : bestAll.value.slice(0, 8)));

/** Revenue per hour of day — find the peak selling times. */
const hourly = computed(() => {
  const buckets = new Array(24).fill(0) as number[];
  for (const tx of scopedTransactions.value) {
    if (tx.revertedBy) continue;
    buckets[new Date(tx.timestamp).getHours()] += amountOf(tx);
  }
  const active = buckets.map((v, h) => ({ h, v })).filter((b) => b.v > 0);
  if (!active.length) return [];
  // Show the contiguous range from first to last active hour
  const from = active[0]!.h;
  const to = active[active.length - 1]!.h;
  const max = Math.max(...buckets);
  return buckets.slice(from, to + 1).map((v, i) => ({
    h: from + i,
    v,
    pct: Math.round((v / max) * 100),
  }));
});

// ── Cash drawer: float, expected cash and a printable day report ────────────
const floatInput = ref('');
const countedInput = ref('');

watch(
  scopeEvent,
  async (ev) => {
    floatInput.value = ev ? String((await getSetting<number>(`cashFloat.${ev.id}`)) ?? '') : '';
    countedInput.value = '';
  },
  { immediate: true },
);

async function saveFloat(): Promise<void> {
  if (!scopeEvent.value) return;
  await setSyncedSetting(`cashFloat.${scopeEvent.value.id}`, parseFloat(floatInput.value) || 0);
}

/** Revenue split by payment leg: Cash / Card / each custom method by name. */
const methodBreakdown = computed(() => {
  const CARD_PROVIDERS = new Set(['card', 'mypos-go2', 'mypos-carbon', 'mypos-glass', 'sumup', 'bridge']);
  const map = new Map<string, number>();
  for (const tx of scopedTransactions.value) {
    if (tx.revertedBy) continue;
    for (const leg of tx.payments) {
      const label =
        leg.kind === 'cash' ? 'Cash' : !leg.provider || CARD_PROVIDERS.has(leg.provider) ? 'Card' : leg.provider;
      map.set(label, (map.get(label) ?? 0) + leg.amount);
    }
  }
  return [...map.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
});

const cashDrawer = computed(() => {
  const float = parseFloat(floatInput.value) || 0;
  const cash = methodBreakdown.value.find((m) => m.label === 'Cash')?.amount ?? 0;
  const expected = float + cash;
  const counted = parseFloat(countedInput.value);
  return {
    float,
    cash,
    expected,
    counted: Number.isFinite(counted) ? counted : null,
    diff: Number.isFinite(counted) ? counted - expected : null,
  };
});

/** Z-report: day/event summary on the receipt printer. */
async function printDayReport(): Promise<void> {
  if (!scopeEvent.value) return;
  try {
    const config = await loadReceiptConfig();
    const W = 32;
    const div = '-'.repeat(W);
    const row = (l: string, r: string): string =>
      l.slice(0, Math.max(0, W - r.length - 1)) + ' '.repeat(Math.max(1, W - Math.min(l.length, W - r.length - 1) - r.length)) + r;
    const lines: ReceiptLine[] = [];
    if (config.artist.companyName) lines.push({ kind: 'text', text: config.artist.companyName, align: 'center' });
    lines.push({ kind: 'text', text: 'DAY REPORT', align: 'center', doubleHeight: true });
    lines.push({ kind: 'text', text: scopeEvent.value.name, align: 'center' });
    lines.push({ kind: 'text', text: new Date().toLocaleString('de-CH'), align: 'center' });
    lines.push({ kind: 'text', text: div });
    lines.push({ kind: 'text', text: row('Sales', String(stats.value.count)) });
    lines.push({ kind: 'text', text: row('Items sold', String(stats.value.items)) });
    lines.push({ kind: 'text', text: row('Revenue', fmtPrice(stats.value.revenue, revenueCurrency.value)) });
    lines.push({ kind: 'text', text: div });
    for (const m of methodBreakdown.value) {
      lines.push({ kind: 'text', text: row(m.label, fmtPrice(m.amount, currency.value)) });
    }
    lines.push({ kind: 'text', text: div });
    lines.push({ kind: 'text', text: row('Float', fmtPrice(cashDrawer.value.float, currency.value)) });
    lines.push({ kind: 'text', text: row('Expected cash', fmtPrice(cashDrawer.value.expected, currency.value)) });
    if (cashDrawer.value.counted !== null) {
      lines.push({ kind: 'text', text: row('Counted', fmtPrice(cashDrawer.value.counted, currency.value)) });
      lines.push({
        kind: 'text',
        text: row('Difference', fmtPrice(cashDrawer.value.diff ?? 0, currency.value)),
      });
    }
    lines.push({ kind: 'space' });
    const result = await printReceiptLines(lines);
    showToast(result.printed ? 'Day report printed' : `Report: ${result.error ?? 'print failed'}`, result.printed ? 'success' : 'error');
  } catch (err) {
    showToast(`Report: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

/** Revenue per day for a simple bar chart (divs — no chart lib needed here). */
const compareDaily = ref(false);
const daily = computed(() => {
  const map = new Map<string, number>();
  for (const tx of scopedTransactions.value) {
    if (tx.revertedBy) continue;
    const day = new Date(tx.timestamp).toISOString().slice(0, 10);
    map.set(day, (map.get(day) ?? 0) + amountOf(tx));
  }
  const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const max = Math.max(1, ...entries.map(([, v]) => v));
  // "Day before" = the previous entry in this (possibly sparse) list, not
  // necessarily the literal preceding calendar date — for the common case
  // (a multi-day convention selling daily) these are the same thing.
  return entries.map(([day, value], i) => {
    const prev = i > 0 ? entries[i - 1]![1] : null;
    const delta = prev != null ? round2(value - prev) : null;
    const deltaPct = prev ? Math.round((delta! / prev) * 100) : null;
    return { day, value, pct: (value / max) * 100, delta, deltaPct };
  });
});

async function doRevert(): Promise<void> {
  if (!revertId.value) return;
  await revertTransaction(revertId.value);
  revertId.value = null;
  showToast('Sale reverted — stock restored', 'info');
}

async function exportCsv(): Promise<void> {
  const name = `${(scopeEvent.value?.name || 'all_events').replace(/[^\w-]+/g, '_')}_sales.csv`;
  await saveTextFile(name, transactionsToCsv(scopedTransactions.value), 'text/csv');
}

async function exportPdf(): Promise<void> {
  if (!scopeEvent.value) return;
  try {
    // jsPDF is heavy — load it only when a report is actually requested
    const { buildSalesReportPdf } = await import('@/lib/export/pdf-report');
    const { base64, filename } = buildSalesReportPdf(scopeEvent.value, scopedTransactions.value);
    await saveBinaryFile(filename, base64, 'application/pdf');
  } catch (err) {
    showToast(`PDF export failed: ${err}`, 'error');
  }
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const methodIcons: Record<string, Component> = { cash: Banknote, card: CreditCard, split: Zap };
const methodIcon = (method: string): Component => methodIcons[method] ?? Smartphone;

// ── Receipt reprint (Carbon built-in printer or paired thermal printer) ─────
const canPrintReceipts = ref(false);
void printingAvailable().then((ok) => (canPrintReceipts.value = ok));

async function printReceipt(tx: (typeof visible.value)[number]): Promise<void> {
  try {
    const config = await loadReceiptConfig();
    const lines = buildReceiptLines(tx, eventName(tx.eventId), config);
    const result = await printReceiptLines(lines);
    if (!result.printed) showToast(`Receipt: ${result.error ?? 'print failed'}`, 'error');
  } catch (err) {
    showToast(`Receipt: ${err instanceof Error ? err.message : err}`, 'error');
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl p-4 md:p-6 xl:max-w-6xl">
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <RouterLink
        v-if="fromPos"
        to="/pos"
        class="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
      >
        <ArrowLeft class="h-4 w-4" /> POS
      </RouterLink>
      <h1 class="text-xl font-bold">Sales history</h1>
      <select v-model="scope" class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm">
        <option value="all">All events</option>
        <option v-for="e in data.events" :key="e.id" :value="e.id">{{ e.name }}</option>
      </select>
      <div v-if="hasBaseData" class="flex rounded-lg bg-slate-900 p-1 text-xs ring-1 ring-slate-800">
        <button
          class="rounded-md px-3 py-1"
          :class="amountView === 'local' ? 'bg-slate-700 font-semibold' : 'text-slate-400'"
          @click="amountView = 'local'"
        >
          Local
        </button>
        <button
          class="rounded-md px-3 py-1"
          :class="amountView === 'base' ? 'bg-slate-700 font-semibold' : 'text-slate-400'"
          @click="amountView = 'base'"
        >
          Base
        </button>
      </div>
      <div class="ml-auto flex gap-2">
        <button
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700 disabled:opacity-40"
          :disabled="!scopedTransactions.length"
          @click="exportCsv"
        >
          Export CSV
        </button>
        <button
          v-if="!allMode"
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700 disabled:opacity-40"
          :disabled="!scopedTransactions.length"
          @click="exportPdf"
        >
          PDF report
        </button>
      </div>
    </div>

    <!-- Stat tiles -->
    <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="rounded-xl bg-slate-900 p-3 ring-1 ring-slate-800">
        <p class="text-xs text-slate-400">Revenue</p>
        <p class="text-lg font-bold">{{ fmtPrice(stats.revenue, revenueCurrency) }}</p>
      </div>
      <div class="rounded-xl bg-slate-900 p-3 ring-1 ring-slate-800">
        <p class="text-xs text-slate-400">Sales / items</p>
        <p class="text-lg font-bold">{{ stats.count }} / {{ stats.items }}</p>
      </div>
      <div class="rounded-xl bg-slate-900 p-3 ring-1 ring-slate-800">
        <p class="text-xs text-slate-400">Cash</p>
        <p class="text-lg font-bold">{{ fmtPrice(stats.cash, currency) }}</p>
      </div>
      <div class="rounded-xl bg-slate-900 p-3 ring-1 ring-slate-800">
        <p class="text-xs text-slate-400">Card</p>
        <p class="text-lg font-bold">{{ fmtPrice(stats.card, currency) }}</p>
      </div>
    </div>

    <div class="mb-4 grid gap-3 md:grid-cols-2">
      <!-- Best sellers -->
      <div class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <h2 class="text-sm font-semibold text-slate-300">Best sellers</h2>
          <div class="ml-auto flex rounded-lg bg-slate-800 p-0.5 text-[11px]">
            <button
              v-for="m in bestModes"
              :key="m.id"
              class="rounded-md px-2 py-1"
              :class="bestMode === m.id ? 'bg-slate-600 font-semibold' : 'text-slate-400'"
              @click="bestMode = m.id"
            >
              {{ m.label }}
            </button>
          </div>
        </div>
        <p v-if="!bestSellers.length" class="text-xs text-slate-500">No sales yet.</p>
        <ol class="space-y-1.5">
          <li v-for="(b, i) in bestSellers" :key="b.label" class="flex items-center gap-2 text-sm">
            <span class="w-5 text-right text-xs text-slate-500">{{ i + 1 }}.</span>
            <span
              class="min-w-0 flex-1 truncate"
              :style="b.type ? { color: typeColor(b.type) } : undefined"
            >
              {{ b.label }}
            </span>
            <span class="text-xs text-slate-400">{{ b.qty }}×</span>
            <span class="w-20 text-right font-medium">{{ fmtPrice(b.value, revenueCurrency) }}</span>
          </li>
        </ol>
        <button
          v-if="bestAll.length > 8"
          class="mt-2 text-xs text-emerald-400 hover:underline"
          @click="bestExpanded = !bestExpanded"
        >
          {{ bestExpanded ? 'Show less' : `Show all ${bestAll.length}` }}
        </button>
      </div>

      <!-- Daily chart -->
      <div class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <div class="mb-2 flex items-center gap-2">
          <h2 class="text-sm font-semibold text-slate-300">Revenue per day</h2>
          <button
            v-if="daily.length > 1"
            class="ml-auto rounded-md px-2 py-1 text-[11px]"
            :class="compareDaily ? 'bg-slate-600 font-semibold' : 'bg-slate-800 text-slate-400'"
            @click="compareDaily = !compareDaily"
          >
            vs. day before
          </button>
        </div>
        <p v-if="!daily.length" class="text-xs text-slate-500">No sales yet.</p>
        <div class="space-y-1.5">
          <div v-for="d in daily" :key="d.day" class="flex items-center gap-2 text-xs">
            <span class="w-20 shrink-0 text-slate-400">{{ d.day.slice(5) }}</span>
            <div class="h-4 flex-1 overflow-hidden rounded bg-slate-800">
              <div class="h-full rounded bg-emerald-500/70" :style="{ width: d.pct + '%' }" />
            </div>
            <span
              v-if="compareDaily && d.delta != null"
              class="w-14 shrink-0 text-right"
              :class="d.delta > 0 ? 'text-emerald-400' : d.delta < 0 ? 'text-red-400' : 'text-slate-500'"
            >
              {{ d.delta > 0 ? '+' : '' }}{{ d.deltaPct }}%
            </span>
            <span class="w-20 text-right font-medium">{{ fmtPrice(d.value, revenueCurrency) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="mb-4 grid gap-3 md:grid-cols-2">
      <!-- Hourly revenue: when do people actually buy -->
      <div class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-2 text-sm font-semibold text-slate-300">Revenue per hour</h2>
        <p v-if="!hourly.length" class="text-xs text-slate-500">No sales yet.</p>
        <div v-else class="flex h-28 items-stretch gap-1">
          <div v-for="b in hourly" :key="b.h" class="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div class="flex w-full flex-1 items-end">
              <div
                class="w-full rounded-t bg-emerald-500/70"
                :style="{ height: b.pct + '%' }"
                :title="`${b.h}:00 — ${fmtPrice(b.v, revenueCurrency)}`"
              />
            </div>
            <span class="text-[9px] text-slate-500">{{ b.h % 3 === 0 ? b.h : '' }}</span>
          </div>
        </div>
      </div>

      <!-- Cash drawer / day report (per event) -->
      <div v-if="!allMode" class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-2 text-sm font-semibold text-slate-300">Cash drawer</h2>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Float (opening cash)</span>
            <input
              v-model="floatInput"
              type="number"
              inputmode="decimal"
              class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
              @change="saveFloat"
            />
          </label>
          <label class="block text-sm">
            <span class="text-xs text-slate-400">Counted (end of day)</span>
            <input v-model="countedInput" type="number" inputmode="decimal" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
        </div>
        <div class="mt-3 space-y-1 text-sm">
          <div class="flex justify-between text-slate-400">
            <span>Cash revenue</span><span>{{ fmtPrice(cashDrawer.cash, currency) }}</span>
          </div>
          <div class="flex justify-between font-medium">
            <span>Expected in drawer</span><span>{{ fmtPrice(cashDrawer.expected, currency) }}</span>
          </div>
          <div v-if="cashDrawer.diff !== null" class="flex justify-between font-semibold" :class="Math.abs(cashDrawer.diff) < 0.005 ? 'text-emerald-400' : 'text-amber-400'">
            <span>Difference</span>
            <span>{{ cashDrawer.diff >= 0 ? '+' : '−' }}{{ fmtPrice(Math.abs(cashDrawer.diff), currency) }}</span>
          </div>
          <div v-for="m in methodBreakdown" :key="m.label" class="flex justify-between text-xs text-slate-500">
            <span>{{ m.label }}</span><span>{{ fmtPrice(m.amount, currency) }}</span>
          </div>
        </div>
        <button
          v-if="canPrintReceipts"
          class="mt-3 flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700"
          @click="printDayReport"
        >
          <Printer class="h-3.5 w-3.5" /> Print day report
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <div class="flex flex-wrap rounded-lg bg-slate-900 p-1 ring-1 ring-slate-800">
        <button
          v-for="m in methodOptions"
          :key="m"
          class="rounded-md px-3 py-1 capitalize"
          :class="methodFilter === m ? 'bg-slate-700 font-semibold' : 'text-slate-400'"
          @click="methodFilter = m"
        >
          {{ m }}
        </button>
      </div>
      <label class="flex items-center gap-2 text-xs text-slate-400">
        <input v-model="showReverted" type="checkbox" /> Show reverted
      </label>
    </div>

    <!-- Transactions -->
    <ul class="space-y-2">
      <li
        v-for="tx in visible"
        :key="tx.id"
        class="rounded-xl bg-slate-900 p-3 ring-1 ring-slate-800"
        :class="{ 'opacity-50': tx.revertedBy }"
      >
        <div class="flex items-center gap-2">
          <component :is="methodIcon(tx.method)" class="h-4 w-4 shrink-0 text-slate-400" />
          <span class="text-sm font-semibold">{{ fmtPrice(amountOf(tx), currencyOf(tx)) }}</span>
          <span v-if="allMode" class="truncate rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {{ eventName(tx.eventId) }}
          </span>
          <span v-if="tx.revertedBy" class="rounded bg-red-950 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
            reverted
          </span>
          <span class="ml-auto text-xs text-slate-500">{{ fmtTime(tx.timestamp) }}</span>
          <button
            v-if="canPrintReceipts"
            class="rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            title="Print receipt"
            @click="printReceipt(tx)"
          >
            <Printer class="h-4 w-4" />
          </button>
          <button
            v-if="!tx.revertedBy"
            class="rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-red-950"
            @click="revertId = tx.id"
          >
            Revert
          </button>
        </div>
        <ul class="mt-1.5 space-y-0.5 text-xs text-slate-400">
          <li v-for="(item, i) in tx.items" :key="i" class="flex justify-between">
            <span>
              {{ item.qty }}× {{ item.title }}<span v-if="item.variantLabel"> · {{ item.variantLabel }}</span>
            </span>
            <span>{{ fmtPrice(itemAmountOf(item), currencyOf(tx)) }}</span>
          </li>
          <li v-for="(d, i) in tx.discounts" :key="'d' + i" class="flex justify-between text-emerald-500">
            <span>{{ d.name }}</span>
            <span>− {{ fmtPrice(discountAmountOf(d, tx), currencyOf(tx)) }}</span>
          </li>
        </ul>
      </li>
    </ul>
    <p v-if="!visible.length" class="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400">
      No transactions.
    </p>

    <!-- Revert confirm -->
    <ModalShell v-if="revertId" title="Revert sale?" @close="revertId = null">
      <p class="text-sm text-slate-300">
        The sale is marked as reverted and the items return to stock. The record stays in history.
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm" @click="revertId = null">Cancel</button>
          <button class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white" @click="doRevert">
            Revert sale
          </button>
        </div>
      </template>
    </ModalShell>
  </div>
</template>
