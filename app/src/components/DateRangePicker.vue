<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next';

/**
 * Hotel-style date-range picker: pick start and end on one calendar in a single
 * flow (first click = start, second click = end; clicking before the start moves
 * the start). Values are ISO `yyyy-mm-dd` strings (what the data model stores);
 * everything shown to the user is EU `dd/mm/yyyy`. Two months are rendered so a
 * range across a month boundary needs no navigation.
 */
const props = withDefaults(
  defineProps<{ start: string; end: string; startLabel?: string; endLabel?: string }>(),
  { startLabel: 'Start', endLabel: 'End' },
);
const emit = defineEmits<{ 'update:start': [v: string]; 'update:end': [v: string] }>();

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Ymd { y: number; m: number; d: number }

function parseISO(s: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  return { y: +m[1]!, m: +m[2]! - 1, d: +m[3]! };
}
function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function fmtEU(iso: string): string {
  const p = parseISO(iso);
  return p ? `${String(p.d).padStart(2, '0')}/${String(p.m + 1).padStart(2, '0')}/${p.y}` : '';
}
/** Days since epoch for a y/m/d — a timezone-free integer for ordering/compare. */
function ord(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m, d) / 86400000);
}
function ordISO(iso: string): number | null {
  const p = parseISO(iso);
  return p ? ord(p.y, p.m, p.d) : null;
}

const open = ref(false);
const hover = ref<number | null>(null); // ord of the hovered day while picking the end

// The left-hand month currently in view; starts on the existing start date or today.
const view = ref<{ y: number; m: number }>({ y: 0, m: 0 });
function resetView(): void {
  const base = parseISO(props.start) ?? parseISO(props.end);
  const now = new Date();
  view.value = base ? { y: base.y, m: base.m } : { y: now.getFullYear(), m: now.getMonth() };
}
resetView();

function shiftMonth(delta: number): void {
  const total = view.value.y * 12 + view.value.m + delta;
  view.value = { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
}

interface Cell { d: number; iso: string; ord: number }
function monthGrid(y: number, m: number): (Cell | null)[] {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // convert Sun=0 → Mon=0 start
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (Cell | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push({ d, iso: toISO(y, m, d), ord: ord(y, m, d) });
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
const months = computed(() => {
  const a = view.value;
  const nextTotal = a.y * 12 + a.m + 1;
  const b = { y: Math.floor(nextTotal / 12), m: ((nextTotal % 12) + 12) % 12 };
  return [a, b].map((mm) => ({ ...mm, label: `${MONTHS[mm.m]} ${mm.y}`, cells: monthGrid(mm.y, mm.m) }));
});

const startOrd = computed(() => ordISO(props.start));
const endOrd = computed(() => ordISO(props.end));

function inRange(o: number): boolean {
  const s = startOrd.value;
  if (s == null) return false;
  const e = endOrd.value ?? (hover.value != null && hover.value >= s ? hover.value : null);
  if (e == null) return false;
  return o > Math.min(s, e) && o < Math.max(s, e);
}
function isStart(o: number): boolean {
  return startOrd.value === o;
}
function isEnd(o: number): boolean {
  return endOrd.value === o;
}
function todayOrd(): number {
  const n = new Date();
  return ord(n.getFullYear(), n.getMonth(), n.getDate());
}

function pick(cell: Cell): void {
  const s = startOrd.value;
  // Begin a new range when there's no start yet, or a full range already exists.
  if (s == null || endOrd.value != null) {
    emit('update:start', cell.iso);
    emit('update:end', '');
    hover.value = null;
    return;
  }
  if (cell.ord < s) {
    // Clicked before the start → move the start earlier, keep picking the end.
    emit('update:start', cell.iso);
    return;
  }
  emit('update:end', cell.iso);
  hover.value = null;
  open.value = false; // range complete
}

function clearAll(): void {
  emit('update:start', '');
  emit('update:end', '');
  hover.value = null;
}
function toggle(): void {
  if (!open.value) resetView();
  open.value = !open.value;
}
watch(() => [props.start, props.end], () => { if (!open.value) resetView(); });

const summary = computed(() => {
  const s = fmtEU(props.start);
  const e = fmtEU(props.end);
  if (s && e) return `${s} → ${e}`;
  if (s) return `${s} → …`;
  return '';
});
</script>

<template>
  <div class="relative">
    <!-- Trigger -->
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-left text-sm"
      :class="open ? 'ring-1 ring-emerald-600' : ''"
      @click="toggle"
    >
      <span v-if="summary" class="flex-1 truncate">{{ summary }}</span>
      <span v-else class="flex-1 truncate text-slate-500">{{ startLabel }} → {{ endLabel }} (dd/mm/yyyy)</span>
      <X v-if="summary" class="h-4 w-4 shrink-0 text-slate-500 hover:text-slate-300" @click.stop="clearAll" />
    </button>

    <!-- Calendar panel (inline so it never clips inside a scrollable modal) -->
    <div v-if="open" class="mt-2 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl">
      <div class="mb-2 flex items-center justify-between">
        <button type="button" class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800" @click="shiftMonth(-1)">
          <ChevronLeft class="h-4 w-4" />
        </button>
        <span class="text-xs text-slate-400">Pick the start, then the end</span>
        <button type="button" class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800" @click="shiftMonth(1)">
          <ChevronRight class="h-4 w-4" />
        </button>
      </div>

      <div class="flex flex-col gap-4 sm:flex-row">
        <div v-for="mo in months" :key="mo.label" class="min-w-0 flex-1">
          <p class="mb-1.5 text-center text-sm font-semibold text-slate-200">{{ mo.label }}</p>
          <div class="grid grid-cols-7 gap-0.5">
            <span v-for="w in WEEKDAYS" :key="w" class="py-1 text-center text-[0.6rem] font-medium text-slate-500">{{ w }}</span>
            <template v-for="(cell, i) in mo.cells" :key="i">
              <span v-if="!cell" />
              <button
                v-else
                type="button"
                class="relative h-8 text-center text-xs transition-colors"
                :class="[
                  isStart(cell.ord) || isEnd(cell.ord)
                    ? 'z-10 rounded-lg bg-emerald-600 font-semibold text-white'
                    : inRange(cell.ord)
                      ? 'bg-emerald-600/25 text-emerald-100'
                      : 'rounded-lg text-slate-200 hover:bg-slate-800',
                  cell.ord === todayOrd() && !isStart(cell.ord) && !isEnd(cell.ord) ? 'ring-1 ring-inset ring-slate-600' : '',
                  inRange(cell.ord) && !isStart(cell.ord) && !isEnd(cell.ord) ? 'rounded-none' : '',
                ]"
                @click="pick(cell)"
                @mouseenter="hover = cell.ord"
              >
                {{ cell.d }}
              </button>
            </template>
          </div>
        </div>
      </div>

      <div class="mt-3 flex items-center justify-between border-t border-slate-800 pt-2">
        <button type="button" class="text-xs text-slate-500 hover:text-slate-300" @click="clearAll">Clear</button>
        <button type="button" class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700" @click="open = false">
          Done
        </button>
      </div>
    </div>
  </div>
</template>
