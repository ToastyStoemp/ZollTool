<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import type { PaymentLeg, PaymentMethod, Product, Transaction } from '@zolltool/shared';
import { useDataStore } from '@/stores/data';
import { useSettingsStore } from '@/stores/settings';
import { useCartStore } from '@/stores/cart';
import { findSearchMatch, typeColor } from '@/lib/search';
import { cashShortcutAmounts, splitCashPortionAmounts } from '@/lib/cash';
import { fmtPrice, round2 } from '@/lib/money';
import { showToast } from '@/lib/toast';
import { getProvider } from '@/payments/registry';
import { getSetting, revertTransaction } from '@/db/repo';
import { sendDisplayCart } from '@/sync/engine';
import { DisplayLink } from '@/native/plugins';
import { DISPLAY_KEYS } from '@/lib/display';
import type { DisplayCart, DisplayCartMessage } from '@zolltool/shared';
import { MyPos, Screen, hasNativePlugin } from '@/native/plugins';
import { sendDiagnosticLog } from '@/lib/diagnostics';
import { buildReceiptLines, loadReceiptConfig, printReceipt, printingAvailable } from '@/lib/receipt';
import { ArrowLeft, ChartLine, Check, CreditCard, Printer, ShoppingCart, Undo2, X } from 'lucide-vue-next';
import ModalShell from '@/components/ModalShell.vue';
import ProductThumb from '@/components/ProductThumb.vue';

const data = useDataStore();
const settings = useSettingsStore();
const cart = useCartStore();

const search = ref('');
const variantPickerProduct = ref<Product | null>(null);
const showCartSheet = ref(false);
const showDiscountForm = ref(false);

const discountForm = reactive({ type: 'amount' as 'amount' | 'percent', value: '', name: '' });

// ── Payment state ──────────────────────────────────────────────────────────
type PayPhase = 'idle' | 'confirm' | 'terminal' | 'failed' | 'done' | 'needsLogin';
const payment = reactive({
  phase: 'idle' as PayPhase,
  method: 'cash' as PaymentMethod,
  total: 0,
  cashReceived: '',
  splitCash: '',
  splitCard: '',
  terminalError: '',
});

// "Unlisted" only excludes a product from customs documents — it stays sellable.
const sellable = computed(() => data.products.filter((p) => p.forSale !== false));

const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return sellable.value;
  return sellable.value.filter((p) =>
    [p.title, p.sku, p.type, ...p.variants.flatMap((v) => [v.name, v.sku])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
});

// ── View mode: flat grid or grouped by type (port of legacy "By Type") ──────
const POS_VIEW_KEY = 'zolltool_pos_view';
// Default to grouped-by-type; only stay flat if the user explicitly picked it.
const viewMode = ref<'flat' | 'grouped'>(localStorage.getItem(POS_VIEW_KEY) === 'flat' ? 'flat' : 'grouped');

function setViewMode(mode: 'flat' | 'grouped'): void {
  viewMode.value = mode;
  localStorage.setItem(POS_VIEW_KEY, mode);
}

/** Searching always shows flat results — grouping only applies to browsing. */
const showGrouped = computed(() => viewMode.value === 'grouped' && !search.value.trim());

interface TypeGroup {
  type: string;
  products: Product[];
  stock: number;
  inCart: number;
}

const typeGroups = computed<TypeGroup[]>(() => {
  const map = new Map<string, Product[]>();
  for (const p of sellable.value) {
    const key = p.type || '(no type)';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return [...map.entries()].map(([type, products]) => ({
    type,
    products,
    stock: products.reduce((s, p) => s + Math.max(0, cart.remaining(p.id, null)), 0),
    inCart: products.reduce(
      (s, p) =>
        s +
        (p.variants.length
          ? p.variants.reduce((sv, v) => sv + cart.inCart(p.id, v.id), 0)
          : cart.inCart(p.id, null)),
      0,
    ),
  }));
});

interface GridEntry {
  key: string;
  product?: Product;
  group?: TypeGroup;
}

/** Grouped mode: one card per type; single-product types show the product directly. */
const gridEntries = computed<GridEntry[]>(() => {
  if (!showGrouped.value) return filtered.value.map((p) => ({ key: p.id, product: p }));
  return typeGroups.value.map((g) =>
    g.products.length === 1
      ? { key: g.products[0]!.id, product: g.products[0]! }
      : { key: 't:' + g.type, group: g },
  );
});

const openTypeGroup = ref<string | null>(null);
const typeGroupProducts = computed(() =>
  openTypeGroup.value == null
    ? []
    : sellable.value.filter((p) => (p.type || '(no type)') === openTypeGroup.value),
);

function submitSearch(): void {
  const match = findSearchMatch(data.products, search.value);
  if (!match) {
    showToast('No product found for that search.', 'error');
    return;
  }
  if ('ambiguous' in match) {
    showToast(`${match.count} matches — keep typing to narrow it down.`, 'error');
    return;
  }
  addToCart(match.productId, match.variantId);
  showToast(`Added ${match.label}`, 'success');
  search.value = '';
}

function addToCart(pid: string, vid: string | null): void {
  const product = data.products.find((p) => p.id === pid);
  if (!product) return;
  if (product.variants.length && !vid) {
    variantPickerProduct.value = product;
    return;
  }
  // Out-of-stock products stay sellable — brought counts are often estimates,
  // so the seller is warned but never blocked.
  cart.add(pid, vid);
}

/**
 * Tier quantities of tiered discount rules targeting this product (or one
 * specific variant) — they drive the "+3 / +5" quick-add bundle chips, so only
 * products that actually have such a discount get them.
 */
function bundleQtys(p: Product, vid: string | null = null): number[] {
  const qtys = new Set<number>();
  for (const rule of data.discounts) {
    if (rule.type !== 'tiered' || !rule.tiers?.length || rule.hideQuickAdd) continue;
    const matches =
      rule.productIds.includes(p.id) ||
      (!!p.type && (rule.productTypes ?? []).includes(p.type)) ||
      (vid !== null && rule.variantIds.includes(`${p.id}:${vid}`));
    if (!matches) continue;
    for (const t of rule.tiers) if (t.qty > 1) qtys.add(t.qty);
  }
  return [...qtys].sort((a, b) => a - b).slice(0, 3);
}

/** Quick-add a whole bundle (e.g. the "3 for 10" tier) in one tap. */
function addBundle(pid: string, vid: string | null, qty: number): void {
  cart.setQty(vid ? `${pid}:${vid}` : pid, cart.inCart(pid, vid) + qty);
}

/** Converts a catalog (base-currency) price to the current charge currency, for display tags. */
function tagPrice(pid: string, vid: string | null, basePrice: number): string {
  const shown = data.localPriceFor(pid, vid, basePrice);
  return fmtPrice(shown, cart.chargeCurrency);
}

/** Variant products show their cheapest price instead of an opaque "⋯". */
function fromPrice(p: Product): string {
  const min = Math.min(...p.variants.map((v) => data.localPriceFor(p.id, v.id, v.price ?? p.price)));
  return `from ${fmtPrice(min, cart.chargeCurrency)}`;
}

// ── Last sale: undo fat-fingered checkouts and reprint right at the counter ──
const lastSale = ref<Transaction | null>(null);
const canPrintReceipt = ref(false);
void printingAvailable().then((ok) => (canPrintReceipt.value = ok));

async function undoLastSale(): Promise<void> {
  if (!lastSale.value) return;
  await revertTransaction(lastSale.value.id);
  lastSale.value = null;
  showToast('Sale reverted — stock restored', 'info');
}

async function printLastSale(): Promise<void> {
  if (!lastSale.value) return;
  try {
    const config = await loadReceiptConfig();
    const lines = buildReceiptLines(lastSale.value, data.activeEvent?.name ?? '', config, data.activeEvent?.venue?.country);
    const result = await printReceipt(lines);
    showToast(result.printed ? 'Receipt printed' : `Receipt: ${result.error ?? 'print failed'}`, result.printed ? 'success' : 'error');
  } catch (err) {
    showToast(`Receipt: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

/** Today's non-reverted sales for the active event — the header tally. */
const todayStats = computed(() => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  let count = 0;
  let revenue = 0;
  for (const tx of data.eventTransactions) {
    if (tx.revertedBy || tx.timestamp < start.getTime()) continue;
    count++;
    revenue += tx.baseTotal ?? tx.total;
  }
  return { count, revenue };
});

// ── Two-tap cart clear: one stray tap must not wipe a big cart ──────────────
const clearArmed = ref(false);
let clearTimer: number | undefined;
function tapClear(): void {
  if (!clearArmed.value) {
    clearArmed.value = true;
    window.clearTimeout(clearTimer);
    clearTimer = window.setTimeout(() => (clearArmed.value = false), 3000);
    return;
  }
  window.clearTimeout(clearTimer);
  clearArmed.value = false;
  cart.clear();
}

function stockLabel(pid: string, vid: string | null): { text: string; cls: string } {
  const left = cart.remaining(pid, vid);
  if (left < 0) return { text: `${-left} over stock`, cls: 'text-red-400' };
  if (left === 0) return { text: 'Out of stock', cls: 'text-red-400' };
  if (left <= 3) return { text: `${left} left`, cls: 'text-amber-400' };
  return { text: `${left} in stock`, cls: 'text-slate-400' };
}

// ── Misc sale: one-off items that aren't in the catalog ────────────────────
const showMiscForm = ref(false);
const miscForm = reactive({ title: '', price: '', qty: '1' });

function openMiscForm(): void {
  Object.assign(miscForm, { title: '', price: '', qty: '1' });
  showMiscForm.value = true;
}

function addMiscItem(): void {
  const price = parseFloat(miscForm.price);
  const qty = Math.max(1, Math.floor(Number(miscForm.qty)) || 1);
  if (!Number.isFinite(price) || price <= 0) {
    showToast('Enter a price for the item.', 'error');
    return;
  }
  // Entered in the charge currency (same as everything else on screen); the cart
  // stores catalog-equivalent lines in base currency, so convert back on the way in.
  const basePrice = data.hasLocalCurrency ? price / cart.chargeRate : price;
  cart.addMisc(miscForm.title, round2(basePrice), qty);
  showMiscForm.value = false;
}

// ── Customer display: broadcast the cart to paired display devices ─────────
// Two channels, both carrying the same DisplayCartMessage: the sync server's
// WebSocket (any logged-in device in display mode) and — when a paired device
// is selected in Settings — a direct Bluetooth link that needs no internet.
// Both sends are fire-and-forget (no ack, no retry) — a single dropped frame
// (WS mid-reconnect, a Bluetooth hiccup) used to leave the display stuck
// showing stale content indefinitely, since nothing re-triggers a publish
// until the cart changes again. The heartbeat below re-publishes the true
// current state periodically regardless, so a missed update self-heals
// within one interval instead of needing something else to jostle it.
let displayTimer: ReturnType<typeof setTimeout> | null = null;
let displayHeartbeat: ReturnType<typeof setInterval> | null = null;
const DISPLAY_HEARTBEAT_MS = 15_000;
let thankYouUntil = 0;
const btDisplayReady = ref(false);

onMounted(async () => {
  if (!hasNativePlugin('DisplayLink')) return;
  const address = await getSetting<string>(DISPLAY_KEYS.btAddress);
  if (!address) return;
  try {
    await DisplayLink.configure({ address });
    btDisplayReady.value = true;
  } catch {
    /* plugin unavailable — WS channel still works */
  }
});

function publishCart(paid?: { total: number }): void {
  const cartPayload: DisplayCart = {
    deviceName: settings.deviceName || 'Register',
    eventName: data.activeEvent?.name ?? '',
    currency: cart.chargeCurrency,
    lines: cart.chargeLines.map((l) => ({
      title: l.title,
      variantLabel: l.variantLabel ?? undefined,
      qty: l.qty,
      lineTotal: l.lineTotal,
    })),
    discounts: [
      ...cart.chargeRuleDiscounts.map((r) => ({
        name: r.rule.name,
        amount: r.amount,
      })),
      ...(cart.chargeCustomDiscountAmount > 0.001
        ? [
            {
              name: cart.customDiscount?.name || 'Discount',
              amount: cart.chargeCustomDiscountAmount,
            },
          ]
        : []),
    ],
    total: cart.chargeGrandTotal,
    paid,
    ts: Date.now(),
  };
  sendDisplayCart(cartPayload);
  if (btDisplayReady.value) {
    const msg: DisplayCartMessage = { type: 'display.cart', from: settings.deviceId, cart: cartPayload };
    void DisplayLink.send({ json: JSON.stringify(msg) }).catch(() => {});
  }
}

watch(
  () => cart.totals,
  () => {
    if (displayTimer) return;
    displayTimer = setTimeout(() => {
      displayTimer = null;
      // Don't clobber the post-sale thank-you with the emptied cart
      if (Date.now() < thankYouUntil && !cart.lines.length) return;
      publishCart();
    }, 250);
  },
);

// Standalone mode (Carbon used directly as the register): wake the screen the
// moment the cart goes from empty to non-empty, in case it had dimmed/locked.
watch(
  () => cart.itemCount,
  (n, prev) => {
    if (n > 0 && prev === 0 && hasNativePlugin('Screen')) void Screen.wake();
  },
);
onMounted(() => {
  publishCart();
  displayHeartbeat = setInterval(() => {
    // Don't clobber the post-sale thank-you display mid-window.
    if (Date.now() < thankYouUntil) return;
    publishCart();
  }, DISPLAY_HEARTBEAT_MS);
});

// ── Discount form ──────────────────────────────────────────────────────────
function openDiscountForm(): void {
  const current = cart.customDiscount;
  discountForm.type = current?.type ?? 'amount';
  // Stored in base currency (matches computeCartTotals, which runs on base-currency
  // lines); shown in the charge currency like everything else on screen.
  const shown =
    current && current.type === 'amount' && data.hasLocalCurrency
      ? current.value * cart.chargeRate
      : current?.value;
  discountForm.value = current ? String(round2(shown ?? current.value)) : '';
  discountForm.name = current?.name ?? '';
  showDiscountForm.value = true;
}

function applyDiscount(): void {
  const entered = parseFloat(discountForm.value) || 0;
  if (entered <= 0) {
    showToast('Enter a discount value.', 'error');
    return;
  }
  if (discountForm.type === 'percent' && entered > 100) {
    showToast('Percent discount cannot be over 100%.', 'error');
    return;
  }
  // Entered in the charge currency (same as everything else on screen); convert
  // back to base currency on the way in, same as addMisc's price field.
  const value =
    discountForm.type === 'amount' && data.hasLocalCurrency ? entered / cart.chargeRate : entered;
  cart.customDiscount = {
    type: discountForm.type,
    value,
    name: discountForm.name.trim() || 'Custom discount',
  };
  showDiscountForm.value = false;
}

// ── Payment flow ───────────────────────────────────────────────────────────
const activeProvider = computed(() => getProvider(settings.paymentProviderId));

// ── Terminal connection indicator ───────────────────────────────────────────
// Shown whenever a real card reader is selected (anything but manual entry).
// Polled while the POS is open; the MyPos plugin additionally pushes
// terminalStatus events so BT connects/drops show up instantly.
const showTerminalState = computed(() => activeProvider.value.id !== 'manual');
const terminalConnected = ref<boolean | null>(null); // null = still checking
const terminalDetail = ref('');

async function refreshTerminalStatus(): Promise<void> {
  if (!showTerminalState.value) return;
  try {
    const s = await activeProvider.value.getStatus();
    terminalConnected.value = s.connected;
    terminalDetail.value = s.detail ?? '';
  } catch (err) {
    terminalConnected.value = false;
    terminalDetail.value = String(err);
  }
}

function tapTerminalState(): void {
  void refreshTerminalStatus();
  const state =
    terminalConnected.value === true ? 'connected' : terminalConnected.value === false ? 'not connected' : 'checking…';
  showToast(`${activeProvider.value.label}: ${terminalDetail.value || state}`, terminalConnected.value ? 'info' : 'error');
}

let statusTimer: number | undefined;
let statusListener: { remove: () => Promise<void> } | null = null;

watch(
  () => settings.paymentProviderId,
  () => {
    terminalConnected.value = null;
    terminalDetail.value = '';
    void refreshTerminalStatus();
  },
);

onMounted(async () => {
  void refreshTerminalStatus();
  statusTimer = window.setInterval(refreshTerminalStatus, 5000);
  if (hasNativePlugin('MyPos')) {
    statusListener = await MyPos.addListener('terminalStatus', (s) => {
      if (activeProvider.value.id === 'mypos-go2') {
        terminalConnected.value = s.connected;
        terminalDetail.value = s.connected ? 'Terminal ready' : 'Terminal not paired';
      }
    });
  }
});

onUnmounted(() => {
  if (statusTimer) window.clearInterval(statusTimer);
  if (displayHeartbeat) window.clearInterval(displayHeartbeat);
  void statusListener?.remove().catch(() => {});
});

const cashShortcuts = computed(() =>
  payment.method === 'cash' ? cashShortcutAmounts(payment.total, cart.chargeCurrency) : [],
);

const splitCashShortcuts = computed(() => {
  const card = parseFloat(payment.splitCard) || 0;
  return splitCashPortionAmounts(Math.max(0, payment.total - card), cart.chargeCurrency);
});

const change = computed(() => (parseFloat(payment.cashReceived) || 0) - payment.total);

const splitState = computed(() => {
  const cash = parseFloat(payment.splitCash) || 0;
  const card = parseFloat(payment.splitCard) || 0;
  const remaining = payment.total - cash - card;
  if (remaining > 0.001) return { ok: false, label: 'Remaining', amount: remaining, cls: 'text-red-400' };
  if (remaining < -0.001) return { ok: false, label: 'Over by', amount: -remaining, cls: 'text-amber-400' };
  return { ok: cash > 0 || card > 0, label: 'Paid', amount: cash + card, cls: 'text-emerald-400' };
});

const confirmDisabled = computed(() => {
  if (payment.method === 'cash') return (parseFloat(payment.cashReceived) || 0) < payment.total - 0.001;
  if (payment.method === 'split') return !splitState.value.ok;
  return false;
});

function startPayment(method: PaymentMethod): void {
  if (!cart.itemCount) return;
  if (!settings.activeEventId) {
    showToast('Pick an active event first.', 'error');
    return;
  }
  payment.method = method;
  payment.total = cart.chargeGrandTotal;
  payment.cashReceived = payment.total.toFixed(2);
  payment.splitCash = '';
  payment.splitCard = '';
  payment.terminalError = '';
  diagnosticsSent.value = false;

  if (method === 'card' && activeProvider.value.id !== 'manual') {
    void beginCardPayment();
    return;
  }
  payment.phase = 'confirm';
}

/**
 * Card + a real reader: if the reader needs an interactive sign-in (SumUp) and
 * isn't logged in, show the connect-or-choose-another-method screen instead of
 * diving into a terminal payment that would just fail.
 */
async function beginCardPayment(): Promise<void> {
  try {
    if (await activeProvider.value.needsLogin?.()) {
      payment.phase = 'needsLogin';
      return;
    }
  } catch {
    /* if the check itself fails, fall through and let the terminal report it */
  }
  payment.phase = 'terminal';
  void runTerminalPayment();
}

/** From the needsLogin screen: log in to the reader, then take the payment. */
async function connectCardReader(): Promise<void> {
  const provider = activeProvider.value;
  if (!provider.configure) return;
  try {
    await provider.configure();
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), 'error');
    return; // stay on the needsLogin screen so they can retry or pick another method
  }
  if (await provider.needsLogin?.()) {
    showToast(`Still not signed in to ${provider.label}`, 'error');
    return;
  }
  void refreshTerminalStatus();
  payment.phase = 'terminal';
  void runTerminalPayment();
}

/** From the needsLogin screen: record the card without the reader (manual entry). */
function recordCardManually(): void {
  payment.method = 'card';
  payment.phase = 'confirm';
}

async function runTerminalPayment(): Promise<void> {
  const provider = activeProvider.value;
  try {
    const result = await provider.startPayment({
      amount: payment.total,
      currency: cart.chargeCurrency,
      reference: `zoll-${Date.now()}`,
    });
    if (payment.phase !== 'terminal') return; // cancelled meanwhile
    if (result.approved) {
      await finishSale([
        {
          kind: 'card',
          amount: payment.total,
          provider: result.provider,
          txRef: result.txRef,
          cardBrand: result.cardBrand,
          authCode: result.authCode,
        },
      ]);
      showToast(`Card approved${result.cardBrand ? ' · ' + result.cardBrand : ''}`, 'success');
    } else {
      // Keep the modal open so the seller can retry the card or complete the
      // sale manually (e.g. the customer pays cash instead).
      payment.terminalError = result.error || 'Card payment declined';
      payment.phase = 'failed';
    }
  } catch (err) {
    if (payment.phase !== 'terminal') return;
    payment.terminalError = err instanceof Error ? err.message : String(err);
    payment.phase = 'failed';
  }
}

function retryTerminal(): void {
  payment.terminalError = '';
  payment.phase = 'terminal';
  void runTerminalPayment();
}

const sendingDiagnostics = ref(false);
const diagnosticsSent = ref(false);

async function sendPaymentDiagnostics(): Promise<void> {
  sendingDiagnostics.value = true;
  try {
    await sendDiagnosticLog('payment-failed');
    diagnosticsSent.value = true;
  } catch (err) {
    showToast(`Send failed: ${err instanceof Error ? err.message : err}`, 'error');
  } finally {
    sendingDiagnostics.value = false;
  }
}

async function cancelPayment(): Promise<void> {
  if (payment.phase === 'terminal') {
    await activeProvider.value.cancel().catch(() => {});
  }
  payment.phase = 'idle';
}

async function confirmPayment(): Promise<void> {
  let legs: PaymentLeg[] = [];
  if (payment.method === 'split') {
    legs = [
      { kind: 'cash' as const, amount: Math.max(0, parseFloat(payment.splitCash) || 0) },
      { kind: 'card' as const, amount: Math.max(0, parseFloat(payment.splitCard) || 0) },
    ].filter((l) => l.amount > 0);
  } else if (isCustomMethod(payment.method)) {
    // Custom methods (TWINT, PayPal QR, …) count as non-cash money
    legs = [{ kind: 'card', amount: payment.total, provider: payment.method }];
  }
  await finishSale(legs);
}

function isCustomMethod(method: PaymentMethod): boolean {
  return method !== 'cash' && method !== 'card' && method !== 'split';
}

async function finishSale(legs: PaymentLeg[]): Promise<void> {
  const count = cart.itemCount;
  const tx = await cart.checkout(payment.method, legs);
  payment.phase = 'idle';
  showCartSheet.value = false;
  lastSale.value = tx;
  showToast(`Payment confirmed — ${count} item${count !== 1 ? 's' : ''} sold`, 'success');
  thankYouUntil = Date.now() + 6000;
  publishCart({ total: tx.total });
  void maybePrintReceipt(tx);
}

/**
 * Print a receipt after the sale — only when the user opted in via Settings
 * (off by default) and this device has a printer (Carbon built-in or a paired
 * Bluetooth thermal printer).
 */
async function maybePrintReceipt(tx: Awaited<ReturnType<typeof cart.checkout>>): Promise<void> {
  try {
    const config = await loadReceiptConfig();
    if (!config.autoPrint || !(await printingAvailable())) return;
    const lines = buildReceiptLines(tx, data.activeEvent?.name ?? '', config, data.activeEvent?.venue?.country);
    const result = await printReceipt(lines);
    if (!result.printed) showToast(`Receipt: ${result.error ?? 'print failed'}`, 'error');
  } catch (err) {
    showToast(`Receipt: ${err instanceof Error ? err.message : err}`, 'error');
  }
}
</script>

<template>
  <div class="flex h-full flex-col md:flex-row">
    <!-- No active event -->
    <div v-if="!data.activeEvent" class="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 class="text-xl font-bold">No active event</h1>
      <p class="max-w-sm text-sm text-slate-400">
        Sales are recorded per event. Create or activate one to start selling.
      </p>
      <RouterLink
        to="/events"
        class="zui-btn zui-btn-primary"
      >
        Go to Events
      </RouterLink>
    </div>

    <template v-else>
      <!-- Product area -->
      <section class="flex min-h-0 min-w-0 flex-1 flex-col">
        <header class="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3">
          <RouterLink to="/events" class="shrink-0 rounded-lg px-1.5 py-1.5 text-slate-400 hover:bg-slate-800" title="Back to events">
            <ArrowLeft class="h-4 w-4" />
          </RouterLink>
          <div class="min-w-0">
            <h1 class="truncate text-sm font-semibold text-emerald-400">{{ data.activeEvent.name }}</h1>
            <p class="truncate text-[10px] leading-tight text-slate-500">
              Today {{ todayStats.count }} sale{{ todayStats.count === 1 ? '' : 's' }} ·
              {{ fmtPrice(todayStats.revenue, data.currency) }}
            </p>
          </div>
          <RouterLink
            :to="{ path: '/history', query: { event: data.activeEvent.id, from: 'pos' } }"
            class="shrink-0 rounded-lg px-1.5 py-1.5 text-slate-400 hover:bg-slate-800"
            title="Sales history"
          >
            <ChartLine class="h-4 w-4" />
          </RouterLink>
          <!-- Card reader connection state (hidden for manual entry) -->
          <button
            v-if="showTerminalState"
            class="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-800/60 px-2 py-1.5 text-sm hover:bg-slate-800"
            :title="`${activeProvider.label} — tap to re-check`"
            @click="tapTerminalState"
          >
            <CreditCard class="h-4 w-4 text-slate-300" />
            <span
              class="h-2 w-2 rounded-full"
              :class="{
                'bg-emerald-500': terminalConnected === true,
                'bg-red-500': terminalConnected === false,
                'animate-pulse bg-slate-500': terminalConnected === null,
              }"
            />
          </button>
          <input
            v-model="search"
            placeholder="Search / scan…"
            class="ml-auto min-w-0 w-40 rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500 sm:w-64"
            @keydown.enter="submitSearch"
          />
          <div class="flex shrink-0 gap-1.5">
            <button class="zui-pill" :class="{ 'is-active': viewMode === 'flat' }" @click="setViewMode('flat')">All</button>
            <button class="zui-pill" :class="{ 'is-active': viewMode === 'grouped' }" @click="setViewMode('grouped')">Types</button>
          </div>
        </header>

        <!-- Last sale: undo / reprint without leaving the counter -->
        <div
          v-if="lastSale"
          class="flex items-center gap-2 border-b border-emerald-900/60 bg-emerald-950/40 px-4 py-1.5 text-sm"
        >
          <Check class="h-4 w-4 shrink-0 text-emerald-400" />
          <span class="min-w-0 truncate text-emerald-300">
            {{ fmtPrice(lastSale.total, lastSale.currency) }} ·
            {{ lastSale.items.reduce((s, i) => s + i.qty, 0) }} item{{ lastSale.items.reduce((s, i) => s + i.qty, 0) === 1 ? '' : 's' }}
          </span>
          <div class="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              v-if="canPrintReceipt"
              class="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium hover:bg-slate-700"
              @click="printLastSale"
            >
              <Printer class="h-3.5 w-3.5" /> Receipt
            </button>
            <button
              class="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-slate-700"
              @click="undoLastSale"
            >
              <Undo2 class="h-3.5 w-3.5" /> Undo
            </button>
            <button class="rounded-lg px-1.5 py-1 text-slate-500 hover:bg-slate-800" @click="lastSale = null">
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div class="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto overflow-x-hidden p-3 sm:grid-cols-3 lg:grid-cols-4">
          <template v-for="e in gridEntries" :key="e.key">
          <!-- Type card (grouped view) -->
          <button
            v-if="e.group"
            class="relative flex flex-col items-start gap-1 rounded-xl bg-slate-900 p-3 text-left ring-1 ring-slate-800 transition active:scale-[0.98]"
            :style="{ borderLeft: `3px solid ${typeColor(e.group.type)}` }"
            :class="{ 'opacity-60': e.group.stock <= 0 }"
            @click="openTypeGroup = e.group.type"
          >
            <span
              v-if="e.group.inCart"
              class="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-500 px-1 text-xs font-bold text-slate-950"
            >
              {{ e.group.inCart }}
            </span>
            <span class="line-clamp-2 text-sm font-bold" :style="{ color: typeColor(e.group.type) }">
              {{ e.group.type }}
            </span>
            <span class="text-[11px] text-slate-500">{{ e.group.products.length }} products</span>
            <span class="mt-auto flex w-full items-center justify-between pt-1 text-xs">
              <span :class="e.group.stock <= 0 ? 'text-red-400' : 'text-slate-400'">
                {{ e.group.stock <= 0 ? 'Out of stock' : `${e.group.stock} in stock` }}
              </span>
              <span class="font-semibold text-slate-200">⋯</span>
            </span>
          </button>
          <!-- Product card -->
          <template v-else>
          <button
            v-for="p in [e.product!]"
            :key="p.id"
            class="relative flex flex-col items-start gap-1 rounded-xl bg-slate-900 p-3 text-left ring-1 ring-slate-800 transition active:scale-[0.98]"
            :style="{ borderLeft: `3px solid ${typeColor(p.type)}` }"
            :class="{ 'opacity-60': cart.remaining(p.id, null) <= 0 }"
            @click="addToCart(p.id, null)"
          >
            <span
              v-if="cart.inCart(p.id, null) || p.variants.some((v) => cart.inCart(p.id, v.id))"
              class="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-500 px-1 text-xs font-bold text-slate-950"
            >
              {{ p.variants.length ? p.variants.reduce((s, v) => s + cart.inCart(p.id, v.id), 0) : cart.inCart(p.id, null) }}
            </span>
            <span class="flex w-full items-start gap-2">
              <ProductThumb v-if="p.imageId" :image-id="p.imageId" :type="p.type" />
              <span class="line-clamp-2 text-sm font-semibold">{{ p.title || '(untitled)' }}</span>
            </span>
            <span v-if="p.sku" class="text-[11px] text-slate-500">{{ p.sku }}</span>
            <!-- Bundle quick-add, derived from the product's tiered discount (spans: no nested buttons) -->
            <span v-if="!p.variants.length && bundleQtys(p).length" class="flex flex-wrap gap-1.5 pt-1">
              <span
                v-for="q in bundleQtys(p)"
                :key="q"
                role="button"
                class="rounded-md bg-emerald-950 px-2 py-1 text-[11px] font-bold text-emerald-400 ring-1 ring-emerald-800 active:bg-emerald-900"
                @click.stop="addBundle(p.id, null, q)"
              >
                +{{ q }}
              </span>
            </span>
            <span class="mt-auto flex w-full items-center justify-between pt-1 text-xs">
              <span :class="stockLabel(p.id, null).cls">{{ stockLabel(p.id, null).text }}</span>
              <span class="font-semibold text-slate-200">
                {{ p.variants.length ? fromPrice(p) : tagPrice(p.id, null, p.price) }}
              </span>
            </span>
          </button>
          </template>
          </template>
        </div>

        <!-- Mobile cart bar -->
        <button
          v-if="cart.itemCount"
          class="m-3 flex items-center justify-between rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white md:hidden"
          @click="showCartSheet = true"
        >
          <span class="flex items-center gap-2">
            <ShoppingCart class="h-4.5 w-4.5" />
            {{ cart.itemCount }} item{{ cart.itemCount !== 1 ? 's' : '' }}
          </span>
          <span>{{ fmtPrice(cart.chargeGrandTotal, cart.chargeCurrency) }}</span>
        </button>
      </section>

      <!-- Cart panel (desktop) / sheet (mobile) -->
      <aside
        class="border-slate-800 bg-slate-900 md:flex md:w-80 md:shrink-0 md:flex-col md:border-l"
        :class="
          showCartSheet
            ? 'fixed inset-0 z-40 flex flex-col pt-[var(--safe-top)] pb-[var(--safe-bottom)]'
            : 'hidden'
        "
      >
        <header class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 class="font-semibold">Cart</h2>
          <div class="flex gap-2">
            <button
              v-if="cart.itemCount"
              class="text-xs"
              :class="clearArmed ? 'font-semibold text-red-400' : 'text-slate-400 hover:text-red-400'"
              @click="tapClear"
            >
              {{ clearArmed ? 'Really clear?' : 'Clear' }}
            </button>
            <button class="text-slate-400 md:hidden" @click="showCartSheet = false"><X class="h-5 w-5" /></button>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          <p v-if="!cart.lines.length" class="py-8 text-center text-sm text-slate-500">Cart is empty</p>
          <ul class="space-y-2">
            <li
              v-for="l in cart.chargeLines"
              :key="l.pid + ':' + (l.vid || '')"
              class="rounded-lg bg-slate-800/60 p-2.5"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate text-sm">
                  {{ l.title }}<span v-if="l.variantLabel" class="text-slate-400"> · {{ l.variantLabel }}</span>
                </span>
                <span class="text-sm font-semibold">{{ fmtPrice(l.lineTotal, cart.chargeCurrency) }}</span>
              </div>
              <div class="mt-1.5 flex items-center gap-2">
                <button
                  class="h-7 w-7 rounded-md bg-slate-700 text-sm font-bold"
                  @click="cart.setQty(l.vid ? `${l.pid}:${l.vid}` : l.pid, l.qty - 1)"
                >
                  −
                </button>
                <span class="w-6 text-center text-sm">{{ l.qty }}</span>
                <button
                  class="h-7 w-7 rounded-md bg-slate-700 text-sm font-bold"
                  @click="cart.setQty(l.vid ? `${l.pid}:${l.vid}` : l.pid, l.qty + 1)"
                >
                  +
                </button>
                <span class="ml-auto text-xs text-slate-500">à {{ fmtPrice(l.unitPrice, cart.chargeCurrency) }}</span>
              </div>
            </li>
          </ul>
        </div>

        <footer class="space-y-2 border-t border-slate-800 p-3">
          <div class="space-y-1 text-sm">
            <div class="flex justify-between text-slate-400">
              <span>Subtotal</span>
              <span>{{ fmtPrice(cart.chargeSubtotal, cart.chargeCurrency) }}</span>
            </div>
            <div
              v-for="r in cart.chargeRuleDiscounts"
              :key="r.rule.id"
              class="flex justify-between text-emerald-400"
            >
              <span>{{ r.rule.name }}</span>
              <span>− {{ fmtPrice(r.amount, cart.chargeCurrency) }}</span>
            </div>
            <div v-if="cart.chargeCustomDiscountAmount > 0.001" class="flex justify-between text-emerald-400">
              <span>{{ cart.customDiscount?.name }}</span>
              <span>− {{ fmtPrice(cart.chargeCustomDiscountAmount, cart.chargeCurrency) }}</span>
            </div>
            <div
              v-if="Math.abs(cart.chargeRoundingAdjustment) > 0.001"
              class="flex justify-between text-slate-400"
            >
              <span>Rounding</span>
              <span>{{ cart.chargeRoundingAdjustment > 0 ? '+ ' : '− ' }}{{ fmtPrice(Math.abs(cart.chargeRoundingAdjustment), cart.chargeCurrency) }}</span>
            </div>
            <div class="flex justify-between text-base font-bold">
              <span>Total</span><span>{{ fmtPrice(cart.chargeGrandTotal, cart.chargeCurrency) }}</span>
            </div>
          </div>
          <div class="flex gap-2">
            <button
              class="flex-1 rounded-lg bg-slate-800 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-40"
              :disabled="!cart.itemCount"
              @click="openDiscountForm"
            >
              {{ cart.customDiscount ? 'Edit discount' : '+ Discount' }}
            </button>
            <button
              class="flex-1 rounded-lg bg-slate-800 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700"
              @click="openMiscForm"
            >
              + Misc item
            </button>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <button
              class="rounded-lg bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-40"
              :disabled="!cart.itemCount"
              @click="startPayment('cash')"
            >
              Cash
            </button>
            <button
              class="rounded-lg bg-sky-600 py-2.5 text-sm font-bold text-white disabled:opacity-40"
              :disabled="!cart.itemCount"
              @click="startPayment('card')"
            >
              Card
            </button>
            <button
              class="rounded-lg bg-amber-600 py-2.5 text-sm font-bold text-white disabled:opacity-40"
              :disabled="!cart.itemCount"
              @click="startPayment('split')"
            >
              Split
            </button>
          </div>
          <div v-if="settings.customPaymentMethods.length" class="grid grid-cols-2 gap-2">
            <button
              v-for="m in settings.customPaymentMethods"
              :key="m"
              class="truncate rounded-lg bg-violet-700 px-2 py-2 text-sm font-bold text-white disabled:opacity-40"
              :disabled="!cart.itemCount"
              @click="startPayment(m)"
            >
              {{ m }}
            </button>
          </div>
        </footer>
      </aside>
    </template>

    <!-- Type drill-down (grouped view) — stays open for multi-add -->
    <ModalShell v-if="openTypeGroup" :title="openTypeGroup" @close="openTypeGroup = null">
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="p in typeGroupProducts"
          :key="p.id"
          class="relative flex flex-col items-start gap-1 rounded-xl bg-slate-800 p-3 text-left ring-1 ring-slate-700"
          :class="{ 'opacity-60': cart.remaining(p.id, null) <= 0 }"
          @click="addToCart(p.id, null)"
        >
          <span
            v-if="cart.inCart(p.id, null) || p.variants.some((v) => cart.inCart(p.id, v.id))"
            class="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-500 px-1 text-xs font-bold text-slate-950"
          >
            {{ p.variants.length ? p.variants.reduce((s, v) => s + cart.inCart(p.id, v.id), 0) : cart.inCart(p.id, null) }}
          </span>
          <span class="flex w-full items-start gap-2">
            <ProductThumb v-if="p.imageId" :image-id="p.imageId" :type="p.type" />
            <span class="line-clamp-2 text-sm font-semibold">{{ p.title || '(untitled)' }}</span>
          </span>
          <span v-if="p.sku" class="text-[11px] text-slate-500">{{ p.sku }}</span>
          <span v-if="!p.variants.length && bundleQtys(p).length" class="flex flex-wrap gap-1.5 pt-1">
            <span
              v-for="q in bundleQtys(p)"
              :key="q"
              role="button"
              class="rounded-md bg-emerald-950 px-2 py-1 text-[11px] font-bold text-emerald-400 ring-1 ring-emerald-800 active:bg-emerald-900"
              @click.stop="addBundle(p.id, null, q)"
            >
              +{{ q }}
            </span>
          </span>
          <span class="mt-auto flex w-full items-center justify-between pt-1 text-xs">
            <span :class="stockLabel(p.id, null).cls">{{ stockLabel(p.id, null).text }}</span>
            <span class="font-semibold text-slate-200">
              {{ p.variants.length ? fromPrice(p) : tagPrice(p.id, null, p.price) }}
            </span>
          </span>
        </button>
      </div>
    </ModalShell>

    <!-- Variant picker -->
    <ModalShell
      v-if="variantPickerProduct"
      :title="variantPickerProduct.title || 'Choose a variant'"
      @close="variantPickerProduct = null"
    >
      <!-- Stays open so several variants can be added in a row; the badge mirrors the product cards. -->
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="v in variantPickerProduct.variants"
          :key="v.id"
          class="relative flex flex-col items-start gap-1 rounded-xl bg-slate-800 p-3 text-left ring-1 ring-slate-700 transition active:scale-[0.98]"
          :class="{ 'opacity-60': cart.remaining(variantPickerProduct.id, v.id) <= 0 }"
          @click="addToCart(variantPickerProduct!.id, v.id)"
        >
          <span
            v-if="cart.inCart(variantPickerProduct.id, v.id)"
            class="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-500 px-1 text-xs font-bold text-slate-950"
          >
            {{ cart.inCart(variantPickerProduct.id, v.id) }}
          </span>
          <!-- Only the variant's own photo — a product-level fallback would misrepresent the variant -->
          <ProductThumb v-if="v.imageId" :image-id="v.imageId" :type="variantPickerProduct.type" />
          <span class="text-sm font-semibold">{{ v.name || '(untitled)' }}</span>
          <span v-if="v.sku" class="text-[11px] text-slate-500">{{ v.sku }}</span>
          <span v-if="bundleQtys(variantPickerProduct, v.id).length" class="flex flex-wrap gap-1.5 pt-1">
            <span
              v-for="q in bundleQtys(variantPickerProduct, v.id)"
              :key="q"
              role="button"
              class="rounded-md bg-emerald-950 px-2 py-1 text-[11px] font-bold text-emerald-400 ring-1 ring-emerald-800 active:bg-emerald-900"
              @click.stop="addBundle(variantPickerProduct!.id, v.id, q)"
            >
              +{{ q }}
            </span>
          </span>
          <span class="flex w-full items-center justify-between pt-1 text-xs">
            <span :class="stockLabel(variantPickerProduct!.id, v.id).cls">
              {{ stockLabel(variantPickerProduct!.id, v.id).text }}
            </span>
            <span class="font-semibold">
              {{ tagPrice(variantPickerProduct!.id, v.id, v.price ?? variantPickerProduct!.price) }}
            </span>
          </span>
        </button>
      </div>
    </ModalShell>

    <!-- Misc item -->
    <ModalShell v-if="showMiscForm" title="Misc item" @close="showMiscForm = false">
      <div class="space-y-3">
        <p class="text-xs text-slate-500">
          Sell something that isn't in the catalog (commission, old stock, …). No stock is tracked
          and discounts don't apply.
        </p>
        <input
          v-model="miscForm.title"
          placeholder="Description (e.g. Commission)"
          class="w-full rounded-lg bg-slate-800 px-3 py-2"
        />
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-sm">
            <span class="text-slate-400">Price ({{ cart.chargeCurrency }})</span>
            <input v-model="miscForm.price" type="number" min="0" step="0.05" inputmode="decimal" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-slate-400">Quantity</span>
            <input v-model="miscForm.qty" type="number" min="1" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm" @click="showMiscForm = false">Cancel</button>
          <button class="zui-btn zui-btn-primary" @click="addMiscItem">
            Add to cart
          </button>
        </div>
      </template>
    </ModalShell>

    <!-- Custom discount -->
    <ModalShell v-if="showDiscountForm" title="Cart discount" @close="showDiscountForm = false">
      <div class="space-y-3">
        <div class="flex gap-2">
          <label
            class="flex-1 cursor-pointer rounded-lg px-3 py-2 text-center text-sm ring-1"
            :class="discountForm.type === 'amount' ? 'bg-emerald-600 text-white ring-emerald-500' : 'bg-slate-800 ring-slate-700'"
          >
            <input v-model="discountForm.type" type="radio" value="amount" class="hidden" />
            Amount ({{ cart.chargeCurrency }})
          </label>
          <label
            class="flex-1 cursor-pointer rounded-lg px-3 py-2 text-center text-sm ring-1"
            :class="discountForm.type === 'percent' ? 'bg-emerald-600 text-white ring-emerald-500' : 'bg-slate-800 ring-slate-700'"
          >
            <input v-model="discountForm.type" type="radio" value="percent" class="hidden" />
            Percent (%)
          </label>
        </div>
        <input
          v-model="discountForm.value"
          type="number"
          min="0"
          step="0.05"
          placeholder="Value"
          class="w-full rounded-lg bg-slate-800 px-3 py-2"
        />
        <input
          v-model="discountForm.name"
          placeholder="Name (optional)"
          class="w-full rounded-lg bg-slate-800 px-3 py-2"
        />
      </div>
      <template #footer>
        <div class="flex justify-between">
          <button
            v-if="cart.customDiscount"
            class="rounded-lg bg-red-950 px-4 py-2 text-sm text-red-400"
            @click="
              cart.customDiscount = null;
              showDiscountForm = false;
            "
          >
            Remove
          </button>
          <div class="ml-auto flex gap-2">
            <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm" @click="showDiscountForm = false">
              Cancel
            </button>
            <button
              class="zui-btn zui-btn-primary"
              @click="applyDiscount"
            >
              Apply
            </button>
          </div>
        </div>
      </template>
    </ModalShell>

    <!-- Payment modal -->
    <ModalShell
      v-if="payment.phase !== 'idle'"
      :title="
        payment.method === 'cash'
          ? 'Cash payment'
          : payment.method === 'card'
            ? 'Card payment'
            : payment.method === 'split'
              ? 'Split payment'
              : `${payment.method} payment`
      "
      @close="cancelPayment"
    >
      <div class="space-y-4 text-center">
        <p class="text-3xl font-bold">{{ fmtPrice(payment.total, cart.chargeCurrency) }}</p>

        <!-- Reader needs sign-in (e.g. SumUp not logged in) -->
        <template v-if="payment.phase === 'needsLogin'">
          <p class="text-sm font-semibold text-amber-400">{{ activeProvider.label }} isn't signed in</p>
          <p class="text-xs text-slate-400">
            Log in to take this card payment on the reader, or record the card another way.
          </p>
        </template>

        <!-- Terminal waiting -->
        <template v-else-if="payment.phase === 'terminal'">
          <p class="animate-pulse text-sm text-slate-300">Present card to terminal…</p>
          <p class="text-xs text-slate-500">{{ activeProvider.label }}</p>
        </template>

        <!-- Terminal declined / failed -->
        <template v-else-if="payment.phase === 'failed'">
          <p class="text-sm font-semibold text-red-400">Card payment didn't go through</p>
          <p v-if="payment.terminalError" class="text-xs text-slate-400">{{ payment.terminalError }}</p>
          <p class="text-xs text-slate-500">
            Retry the card, or complete the sale manually if it was paid another way.
          </p>
          <button
            class="text-xs font-medium text-emerald-400 underline decoration-dotted disabled:opacity-40"
            :disabled="sendingDiagnostics"
            @click="sendPaymentDiagnostics"
          >
            {{ sendingDiagnostics ? 'Sending…' : diagnosticsSent ? 'Log sent' : 'Send log to support' }}
          </button>
        </template>

        <!-- Cash -->
        <template v-else-if="payment.method === 'cash'">
          <div class="flex flex-wrap justify-center gap-2">
            <button
              class="rounded-lg bg-emerald-950 px-3 py-1.5 text-sm font-semibold text-emerald-400 ring-1 ring-emerald-800"
              @click="payment.cashReceived = payment.total.toFixed(2)"
            >
              Exact
            </button>
            <button
              v-for="a in cashShortcuts"
              :key="a"
              class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold"
              @click="payment.cashReceived = String(a)"
            >
              {{ a }}
            </button>
          </div>
          <label class="block text-left text-sm">
            <span class="text-slate-400">Received</span>
            <input
              v-model="payment.cashReceived"
              type="number"
              inputmode="decimal"
              class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-lg"
            />
          </label>
          <p class="text-sm">
            Change:
            <span
              :class="change < -0.001 ? 'text-red-400' : 'text-emerald-400'"
              class="font-semibold"
            >
              {{ change < -0.001 ? '− ' + fmtPrice(-change, cart.chargeCurrency) : change < 0.001 ? 'No change' : fmtPrice(change, cart.chargeCurrency) }}
            </span>
          </p>
        </template>

        <!-- Split -->
        <template v-else-if="payment.method === 'split'">
          <div class="grid grid-cols-2 gap-3 text-left">
            <label class="block text-sm">
              <span class="text-slate-400">Cash</span>
              <input
                v-model="payment.splitCash"
                type="number"
                inputmode="decimal"
                class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
              />
            </label>
            <label class="block text-sm">
              <span class="text-slate-400">Card</span>
              <input
                v-model="payment.splitCard"
                type="number"
                inputmode="decimal"
                class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
              />
            </label>
          </div>
          <div class="flex flex-wrap justify-center gap-2">
            <button
              class="rounded-lg bg-emerald-950 px-3 py-1.5 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-800"
              @click="payment.splitCash = Math.max(0, payment.total - (parseFloat(payment.splitCard) || 0)).toFixed(2)"
            >
              Cash remainder
            </button>
            <button
              v-for="a in splitCashShortcuts"
              :key="a"
              class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold"
              @click="payment.splitCash = String(a)"
            >
              {{ a }}
            </button>
            <button
              class="rounded-lg bg-sky-950 px-3 py-1.5 text-xs font-semibold text-sky-400 ring-1 ring-sky-800"
              @click="payment.splitCard = Math.max(0, payment.total - (parseFloat(payment.splitCash) || 0)).toFixed(2)"
            >
              Card remainder
            </button>
          </div>
          <p class="text-sm">
            {{ splitState.label }}:
            <span :class="splitState.cls" class="font-semibold">{{ fmtPrice(splitState.amount, cart.chargeCurrency) }}</span>
          </p>
        </template>

        <!-- Card / custom method manual confirm -->
        <template v-else>
          <p class="text-sm text-slate-300">
            Confirm the {{ payment.method === 'card' ? 'card' : payment.method }} payment was
            completed{{ payment.method === 'card' && activeProvider.id === 'manual' ? ' (no terminal configured)' : '' }}.
          </p>
        </template>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm" @click="cancelPayment">Cancel</button>
          <button
            v-if="payment.phase === 'confirm'"
            class="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-40"
            :class="
              payment.method === 'cash'
                ? 'bg-emerald-600'
                : payment.method === 'card'
                  ? 'bg-sky-600'
                  : payment.method === 'split'
                    ? 'bg-amber-600'
                    : 'bg-violet-700'
            "
            :disabled="confirmDisabled"
            @click="confirmPayment"
          >
            Confirm sale
          </button>
          <button
            v-if="payment.phase === 'failed'"
            class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white"
            @click="retryTerminal"
          >
            Retry card
          </button>
          <button
            v-if="payment.phase === 'terminal' || payment.phase === 'failed'"
            class="rounded-lg bg-slate-700 px-4 py-2 text-sm"
            @click="
              payment.phase = 'confirm';
              payment.method = 'card';
            "
          >
            Complete manually
          </button>
          <button
            v-if="payment.phase === 'needsLogin'"
            class="rounded-lg bg-slate-700 px-4 py-2 text-sm"
            @click="recordCardManually"
          >
            Enter card manually
          </button>
          <button
            v-if="payment.phase === 'needsLogin' && activeProvider.configure"
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
            @click="connectCardReader"
          >
            Log in
          </button>
        </div>
      </template>
    </ModalShell>
  </div>
</template>
