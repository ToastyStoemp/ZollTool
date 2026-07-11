<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useDataStore } from '@/stores/data';
import { revertTransaction } from '@/db/repo';
import { fmtPrice } from '@/lib/money';
import { transactionsToCsv } from '@/lib/export/csv';
import { saveBinaryFile, saveTextFile } from '@/lib/download';
import { showToast } from '@/lib/toast';
import { buildReceiptLines, loadReceiptConfig } from '@/lib/receipt';
import { CarbonPayment, hasNativePlugin } from '@/native/plugins';
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

const currency = computed(() => scopeEvent.value?.currency ?? data.currency);

function eventName(eventId: string): string {
  return data.events.find((e) => e.id === eventId)?.name ?? '(deleted event)';
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
  const revenue = active.reduce((s, t) => s + t.total, 0);
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

const bestSellers = computed(() => {
  const map = new Map<string, { label: string; qty: number; value: number }>();
  for (const tx of scopedTransactions.value) {
    if (tx.revertedBy) continue;
    for (const item of tx.items) {
      const key = `${item.pid}:${item.vid ?? ''}`;
      const label = item.variantLabel ? `${item.title} · ${item.variantLabel}` : item.title;
      const cur = map.get(key) ?? { label, qty: 0, value: 0 };
      cur.qty += item.qty;
      cur.value += item.lineTotal;
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 8);
});

/** Revenue per day for a simple bar chart (divs — no chart lib needed here). */
const daily = computed(() => {
  const map = new Map<string, number>();
  for (const tx of scopedTransactions.value) {
    if (tx.revertedBy) continue;
    const day = new Date(tx.timestamp).toISOString().slice(0, 10);
    map.set(day, (map.get(day) ?? 0) + tx.total);
  }
  const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return entries.map(([day, value]) => ({ day, value, pct: (value / max) * 100 }));
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

const methodIcons: Record<string, string> = { cash: '💵', card: '💳', split: '⚡' };
const methodIcon = (method: string): string => methodIcons[method] ?? '📱';

// ── Receipt reprint (Carbon terminal only) ──────────────────────────────────
const canPrintReceipts = hasNativePlugin('CarbonPayment');

async function printReceipt(tx: (typeof visible.value)[number]): Promise<void> {
  try {
    const config = await loadReceiptConfig();
    const lines = buildReceiptLines(tx, eventName(tx.eventId), config);
    const result = await CarbonPayment.printReceipt({ lines });
    if (!result.printed) showToast(`Receipt: ${result.error ?? 'print failed'}`, 'error');
  } catch (err) {
    showToast(`Receipt: ${err instanceof Error ? err.message : err}`, 'error');
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl p-4 md:p-6">
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <RouterLink
        v-if="fromPos"
        to="/pos"
        class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
      >
        ← POS
      </RouterLink>
      <h1 class="text-xl font-bold">Sales history</h1>
      <select v-model="scope" class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm">
        <option value="all">All events</option>
        <option v-for="e in data.events" :key="e.id" :value="e.id">{{ e.name }}</option>
      </select>
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
        <p class="text-lg font-bold">{{ fmtPrice(stats.revenue, currency) }}</p>
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
        <h2 class="mb-2 text-sm font-semibold text-slate-300">Best sellers</h2>
        <p v-if="!bestSellers.length" class="text-xs text-slate-500">No sales yet.</p>
        <ol class="space-y-1.5">
          <li v-for="(b, i) in bestSellers" :key="b.label" class="flex items-center gap-2 text-sm">
            <span class="w-5 text-right text-xs text-slate-500">{{ i + 1 }}.</span>
            <span class="min-w-0 flex-1 truncate">{{ b.label }}</span>
            <span class="text-xs text-slate-400">{{ b.qty }}×</span>
            <span class="w-20 text-right font-medium">{{ fmtPrice(b.value, currency) }}</span>
          </li>
        </ol>
      </div>

      <!-- Daily chart -->
      <div class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
        <h2 class="mb-2 text-sm font-semibold text-slate-300">Revenue per day</h2>
        <p v-if="!daily.length" class="text-xs text-slate-500">No sales yet.</p>
        <div class="space-y-1.5">
          <div v-for="d in daily" :key="d.day" class="flex items-center gap-2 text-xs">
            <span class="w-20 shrink-0 text-slate-400">{{ d.day.slice(5) }}</span>
            <div class="h-4 flex-1 overflow-hidden rounded bg-slate-800">
              <div class="h-full rounded bg-emerald-500/70" :style="{ width: d.pct + '%' }" />
            </div>
            <span class="w-20 text-right font-medium">{{ fmtPrice(d.value, currency) }}</span>
          </div>
        </div>
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
          <span>{{ methodIcon(tx.method) }}</span>
          <span class="text-sm font-semibold">{{ fmtPrice(tx.total, tx.currency) }}</span>
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
            🖨
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
            <span>{{ fmtPrice(item.lineTotal, tx.currency) }}</span>
          </li>
          <li v-for="(d, i) in tx.discounts" :key="'d' + i" class="flex justify-between text-emerald-500">
            <span>{{ d.name }}</span>
            <span>− {{ fmtPrice(d.amount, tx.currency) }}</span>
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
