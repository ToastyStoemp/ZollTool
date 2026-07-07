<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { PaymentLeg, PaymentMethod, Product } from '@zolltool/shared';
import { useDataStore } from '@/stores/data';
import { useSettingsStore } from '@/stores/settings';
import { useCartStore } from '@/stores/cart';
import { findSearchMatch, typeColor } from '@/lib/search';
import { cashShortcutAmounts, splitCashPortionAmounts } from '@/lib/cash';
import { fmtPrice, round2 } from '@/lib/money';
import { showToast } from '@/lib/toast';
import { getProvider } from '@/payments/registry';
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
type PayPhase = 'idle' | 'confirm' | 'terminal' | 'done';
const payment = reactive({
  phase: 'idle' as PayPhase,
  method: 'cash' as PaymentMethod,
  total: 0,
  cashReceived: '',
  splitCash: '',
  splitCard: '',
  terminalError: '',
});

const sellable = computed(() =>
  data.products.filter((p) => p.forSale !== false && !p.unlisted),
);

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
  if (cart.remaining(pid, vid) <= 0) {
    showToast('Out of stock', 'error');
    return;
  }
  cart.add(pid, vid);
}

function stockLabel(pid: string, vid: string | null): { text: string; cls: string } {
  const left = cart.remaining(pid, vid);
  if (left <= 0) return { text: 'Out of stock', cls: 'text-red-400' };
  if (left <= 3) return { text: `${left} left`, cls: 'text-amber-400' };
  return { text: `${left} in stock`, cls: 'text-slate-400' };
}

// ── Discount form ──────────────────────────────────────────────────────────
function openDiscountForm(): void {
  const current = cart.customDiscount;
  discountForm.type = current?.type ?? 'amount';
  discountForm.value = current ? String(current.value) : '';
  discountForm.name = current?.name ?? '';
  showDiscountForm.value = true;
}

function applyDiscount(): void {
  const value = parseFloat(discountForm.value) || 0;
  if (value <= 0) {
    showToast('Enter a discount value.', 'error');
    return;
  }
  if (discountForm.type === 'percent' && value > 100) {
    showToast('Percent discount cannot be over 100%.', 'error');
    return;
  }
  cart.customDiscount = {
    type: discountForm.type,
    value,
    name: discountForm.name.trim() || 'Custom discount',
  };
  showDiscountForm.value = false;
}

// ── Payment flow ───────────────────────────────────────────────────────────
const activeProvider = computed(() => getProvider(settings.paymentProviderId));

const cashShortcuts = computed(() =>
  payment.method === 'cash' ? cashShortcutAmounts(payment.total, data.currency) : [],
);

const splitCashShortcuts = computed(() => {
  const card = parseFloat(payment.splitCard) || 0;
  return splitCashPortionAmounts(Math.max(0, payment.total - card), data.currency);
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
  payment.total = round2(cart.totals.grandTotal);
  payment.cashReceived = payment.total.toFixed(2);
  payment.splitCash = '';
  payment.splitCard = '';
  payment.terminalError = '';

  if (method === 'card' && activeProvider.value.id !== 'manual') {
    payment.phase = 'terminal';
    runTerminalPayment();
    return;
  }
  payment.phase = 'confirm';
}

async function runTerminalPayment(): Promise<void> {
  const provider = activeProvider.value;
  try {
    const result = await provider.startPayment({
      amount: payment.total,
      currency: data.currency,
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
      payment.phase = 'idle';
      showToast(result.error || 'Card payment declined', 'error');
    }
  } catch (err) {
    if (payment.phase !== 'terminal') return;
    payment.phase = 'idle';
    showToast(`Terminal: ${err instanceof Error ? err.message : err}`, 'error');
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
  }
  await finishSale(legs);
}

async function finishSale(legs: PaymentLeg[]): Promise<void> {
  const count = cart.itemCount;
  await cart.checkout(payment.method, legs);
  payment.phase = 'idle';
  showCartSheet.value = false;
  showToast(`Payment confirmed — ${count} item${count !== 1 ? 's' : ''} sold`, 'success');
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
        class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
      >
        Go to Events
      </RouterLink>
    </div>

    <template v-else>
      <!-- Product area -->
      <section class="flex min-h-0 flex-1 flex-col">
        <header class="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <div class="min-w-0">
            <h1 class="truncate text-sm font-semibold text-emerald-400">{{ data.activeEvent.name }}</h1>
          </div>
          <input
            v-model="search"
            placeholder="Search / scan…"
            class="ml-auto w-40 rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500 sm:w-64"
            @keydown.enter="submitSearch"
          />
        </header>

        <div class="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-4">
          <button
            v-for="p in filtered"
            :key="p.id"
            class="relative flex flex-col items-start gap-1 rounded-xl bg-slate-900 p-3 text-left ring-1 ring-slate-800 transition active:scale-[0.98]"
            :style="{ borderLeft: `3px solid ${typeColor(p.type)}` }"
            :class="{ 'opacity-40': cart.remaining(p.id, null) <= 0 }"
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
            <span class="mt-auto flex w-full items-center justify-between pt-1 text-xs">
              <span :class="stockLabel(p.id, null).cls">{{ stockLabel(p.id, null).text }}</span>
              <span class="font-semibold text-slate-200">
                {{ p.variants.length ? '⋯' : fmtPrice(p.price, data.currency) }}
              </span>
            </span>
          </button>
        </div>

        <!-- Mobile cart bar -->
        <button
          v-if="cart.itemCount"
          class="m-3 flex items-center justify-between rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white md:hidden"
          @click="showCartSheet = true"
        >
          <span>🛒 {{ cart.itemCount }} item{{ cart.itemCount !== 1 ? 's' : '' }}</span>
          <span>{{ fmtPrice(cart.totals.grandTotal, data.currency) }}</span>
        </button>
      </section>

      <!-- Cart panel (desktop) / sheet (mobile) -->
      <aside
        class="border-slate-800 bg-slate-900 md:flex md:w-80 md:shrink-0 md:flex-col md:border-l"
        :class="showCartSheet ? 'fixed inset-0 z-40 flex flex-col' : 'hidden'"
      >
        <header class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 class="font-semibold">Cart</h2>
          <div class="flex gap-2">
            <button
              v-if="cart.itemCount"
              class="text-xs text-slate-400 hover:text-red-400"
              @click="cart.clear()"
            >
              Clear
            </button>
            <button class="text-slate-400 md:hidden" @click="showCartSheet = false">✕</button>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          <p v-if="!cart.lines.length" class="py-8 text-center text-sm text-slate-500">Cart is empty</p>
          <ul class="space-y-2">
            <li
              v-for="l in cart.lines"
              :key="l.pid + ':' + (l.vid || '')"
              class="rounded-lg bg-slate-800/60 p-2.5"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate text-sm">
                  {{ l.title }}<span v-if="l.variantLabel" class="text-slate-400"> · {{ l.variantLabel }}</span>
                </span>
                <span class="text-sm font-semibold">{{ fmtPrice(l.lineTotal, data.currency) }}</span>
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
                  class="h-7 w-7 rounded-md bg-slate-700 text-sm font-bold disabled:opacity-30"
                  :disabled="cart.remaining(l.pid, l.vid) <= 0"
                  @click="cart.setQty(l.vid ? `${l.pid}:${l.vid}` : l.pid, l.qty + 1)"
                >
                  +
                </button>
                <span class="ml-auto text-xs text-slate-500">à {{ fmtPrice(l.unitPrice, data.currency) }}</span>
              </div>
            </li>
          </ul>
        </div>

        <footer class="space-y-2 border-t border-slate-800 p-3">
          <div class="space-y-1 text-sm">
            <div class="flex justify-between text-slate-400">
              <span>Subtotal</span><span>{{ fmtPrice(cart.totals.subtotal, data.currency) }}</span>
            </div>
            <div
              v-for="r in cart.totals.ruleDiscounts"
              :key="r.rule.id"
              class="flex justify-between text-emerald-400"
            >
              <span>{{ r.rule.name }}</span><span>− {{ fmtPrice(r.amount, data.currency) }}</span>
            </div>
            <div v-if="cart.totals.customDiscountAmount > 0.001" class="flex justify-between text-emerald-400">
              <span>{{ cart.customDiscount?.name }}</span>
              <span>− {{ fmtPrice(cart.totals.customDiscountAmount, data.currency) }}</span>
            </div>
            <div class="flex justify-between text-base font-bold">
              <span>Total</span><span>{{ fmtPrice(cart.totals.grandTotal, data.currency) }}</span>
            </div>
          </div>
          <button
            class="w-full rounded-lg bg-slate-800 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-40"
            :disabled="!cart.itemCount"
            @click="openDiscountForm"
          >
            {{ cart.customDiscount ? 'Edit discount' : '+ Discount' }}
          </button>
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
        </footer>
      </aside>
    </template>

    <!-- Variant picker -->
    <ModalShell
      v-if="variantPickerProduct"
      :title="variantPickerProduct.title || 'Choose a variant'"
      @close="variantPickerProduct = null"
    >
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="v in variantPickerProduct.variants.filter((v) => !v.unlisted)"
          :key="v.id"
          class="flex flex-col items-start gap-1 rounded-xl bg-slate-800 p-3 text-left ring-1 ring-slate-700 disabled:opacity-40"
          :disabled="cart.remaining(variantPickerProduct.id, v.id) <= 0"
          @click="
            addToCart(variantPickerProduct!.id, v.id);
            variantPickerProduct = null;
          "
        >
          <span class="text-sm font-semibold">{{ v.name || '(untitled)' }}</span>
          <span v-if="v.sku" class="text-[11px] text-slate-500">{{ v.sku }}</span>
          <span class="flex w-full items-center justify-between pt-1 text-xs">
            <span :class="stockLabel(variantPickerProduct!.id, v.id).cls">
              {{ stockLabel(variantPickerProduct!.id, v.id).text }}
            </span>
            <span class="font-semibold">
              {{ fmtPrice(v.price ?? variantPickerProduct!.price, data.currency) }}
            </span>
          </span>
        </button>
      </div>
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
            Amount ({{ data.currency }})
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
              class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
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
      :title="payment.method === 'cash' ? 'Cash payment' : payment.method === 'card' ? 'Card payment' : 'Split payment'"
      @close="cancelPayment"
    >
      <div class="space-y-4 text-center">
        <p class="text-3xl font-bold">{{ fmtPrice(payment.total, data.currency) }}</p>

        <!-- Terminal waiting -->
        <template v-if="payment.phase === 'terminal'">
          <p class="animate-pulse text-sm text-slate-300">Present card to terminal…</p>
          <p class="text-xs text-slate-500">{{ activeProvider.label }}</p>
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
              {{ change < -0.001 ? '− ' + fmtPrice(-change, data.currency) : change < 0.001 ? 'No change' : fmtPrice(change, data.currency) }}
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
            <span :class="splitState.cls" class="font-semibold">{{ fmtPrice(splitState.amount, data.currency) }}</span>
          </p>
        </template>

        <!-- Card manual confirm -->
        <template v-else>
          <p class="text-sm text-slate-300">
            Confirm the card payment was completed{{ activeProvider.id === 'manual' ? ' (no terminal configured)' : '' }}.
          </p>
        </template>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm" @click="cancelPayment">Cancel</button>
          <button
            v-if="payment.phase === 'confirm'"
            class="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-40"
            :class="payment.method === 'cash' ? 'bg-emerald-600' : payment.method === 'card' ? 'bg-sky-600' : 'bg-amber-600'"
            :disabled="confirmDisabled"
            @click="confirmPayment"
          >
            Confirm sale
          </button>
          <button
            v-if="payment.phase === 'terminal'"
            class="rounded-lg bg-slate-700 px-4 py-2 text-sm"
            @click="
              payment.phase = 'confirm';
              payment.method = 'card';
            "
          >
            Complete manually
          </button>
        </div>
      </template>
    </ModalShell>
  </div>
</template>
