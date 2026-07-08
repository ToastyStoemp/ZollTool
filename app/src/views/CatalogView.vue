<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { DiscountRule, Product, Variant } from '@zolltool/shared';
import { useDataStore } from '@/stores/data';
import { useSettingsStore } from '@/stores/settings';
import { deleteDiscount, deleteProduct, setStock, upsertDiscount, upsertProduct } from '@/db/repo';
import { uuidv7 } from '@/lib/uuid';
import { fmtPrice } from '@/lib/money';
import { typeColor } from '@/lib/search';
import { showToast } from '@/lib/toast';
import { saveProductImage } from '@/lib/images';
import ModalShell from '@/components/ModalShell.vue';
import ProductThumb from '@/components/ProductThumb.vue';

const data = useDataStore();
const settings = useSettingsStore();

const tab = ref<'products' | 'discounts'>('products');
const search = ref('');

// ── Product editor ─────────────────────────────────────────────────────────
interface VariantForm extends Variant {
  broughtQty: number;
}

const editing = ref(false);
const editId = ref<string | null>(null);
const imageFile = ref<File | null>(null);
const imagePreview = ref<string | null>(null);
const removeImage = ref(false);
const form = reactive({
  title: '',
  sku: '',
  type: '',
  price: '',
  priceNote: '',
  weightG: '',
  tariffNo: '',
  originCountry: '',
  forSale: true,
  unlisted: false,
  broughtQty: 0,
  variants: [] as VariantForm[],
});

const filteredProducts = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return data.products;
  return data.products.filter((p) =>
    [p.title, p.sku, p.type].filter(Boolean).join(' ').toLowerCase().includes(needle),
  );
});

/** The product list is always grouped by type, matching the POS and bulk editor. */
const productGroups = computed(() => {
  const groups = new Map<string, Product[]>();
  for (const p of filteredProducts.value) {
    const type = p.type?.trim() || 'Other';
    const list = groups.get(type) ?? [];
    list.push(p);
    groups.set(type, list);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, products]) => ({ type, products }));
});

function pickImage(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  imageFile.value = file;
  removeImage.value = false;
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value);
  imagePreview.value = URL.createObjectURL(file);
}

function openNew(): void {
  editId.value = null;
  imageFile.value = null;
  imagePreview.value = null;
  removeImage.value = false;
  Object.assign(form, {
    title: '',
    sku: '',
    type: '',
    price: '',
    priceNote: '',
    weightG: '',
    tariffNo: '',
    originCountry: '',
    forSale: true,
    unlisted: false,
    broughtQty: 0,
    variants: [],
  });
  editing.value = true;
}

function openEdit(p: Product): void {
  editId.value = p.id;
  imageFile.value = null;
  imagePreview.value = null;
  removeImage.value = false;
  Object.assign(form, {
    title: p.title,
    sku: p.sku ?? '',
    type: p.type ?? '',
    price: String(p.price ?? ''),
    priceNote: p.priceNote ?? '',
    weightG: p.weightG != null ? String(p.weightG) : '',
    tariffNo: p.tariffNo ?? '',
    originCountry: p.originCountry ?? '',
    forSale: p.forSale,
    unlisted: p.unlisted,
    broughtQty: data.broughtQty(p.id, null),
    variants: p.variants.map((v) => ({ ...v, broughtQty: data.broughtQty(p.id, v.id) })),
  });
  editing.value = true;
}

function addVariant(): void {
  form.variants.push({ id: uuidv7(), name: '', sku: '', price: undefined, broughtQty: 0 });
}

async function saveProduct(): Promise<void> {
  if (!form.title.trim()) {
    showToast('Product needs a title.', 'error');
    return;
  }
  const existing = editId.value ? data.products.find((p) => p.id === editId.value) : null;
  const productId = editId.value ?? uuidv7();

  let imageId = removeImage.value ? undefined : existing?.imageId;
  if (imageFile.value) {
    imageId = await saveProductImage(productId, imageFile.value);
  }

  const product: Product = {
    id: productId,
    title: form.title.trim(),
    sku: form.sku.trim() || undefined,
    type: form.type.trim() || undefined,
    forSale: form.forSale,
    unlisted: form.unlisted,
    price: parseFloat(form.price) || 0,
    priceNote: form.priceNote.trim() || undefined,
    weightG: parseFloat(form.weightG) || undefined,
    tariffNo: form.tariffNo.trim() || undefined,
    tariffRate: existing?.tariffRate,
    vatRate: existing?.vatRate,
    packagingType: existing?.packagingType,
    originCountry: form.originCountry.trim() || undefined,
    variants: form.variants.map(({ broughtQty, ...v }) => ({
      ...v,
      name: v.name.trim(),
      sku: v.sku?.trim() || undefined,
      price: v.price != null && String(v.price) !== '' ? Number(v.price) : undefined,
    })),
    imageId,
    sortOrder: existing?.sortOrder ?? data.products.length,
    updatedAt: Date.now(),
  };
  await upsertProduct(product);

  // Per-event stock for the active event
  if (settings.activeEventId) {
    const eventId = settings.activeEventId;
    if (product.variants.length) {
      for (const v of form.variants) {
        await setStock(eventId, product.id, v.id, Math.max(0, Math.floor(v.broughtQty) || 0));
      }
    } else {
      await setStock(eventId, product.id, '', Math.max(0, Math.floor(form.broughtQty) || 0));
    }
  }

  editing.value = false;
  showToast('Product saved', 'success');
}

const confirmDeleteId = ref<string | null>(null);

// ── Bulk stock editor (per-event brought quantities, grouped by type) ──────
interface BulkRow {
  pid: string;
  /** '' for products without variants (matches the eventStock compound key). */
  vid: string;
  label: string;
  sku?: string;
  sold: number;
  qty: number;
  orig: number;
}

interface BulkGroup {
  type: string;
  rows: BulkRow[];
  setAll: string;
}

const showBulk = ref(false);
const bulkGroups = ref<BulkGroup[]>([]);

function openBulk(): void {
  const groups = new Map<string, BulkRow[]>();
  for (const p of data.products) {
    const type = p.type?.trim() || 'Other';
    const rows = groups.get(type) ?? [];
    if (p.variants.length) {
      for (const v of p.variants) {
        const qty = data.broughtQty(p.id, v.id);
        rows.push({
          pid: p.id,
          vid: v.id,
          label: `${p.title || '(untitled)'} · ${v.name || v.id}`,
          sku: v.sku ?? p.sku,
          sold: data.soldQty(p.id, v.id),
          qty,
          orig: qty,
        });
      }
    } else {
      const qty = data.broughtQty(p.id, null);
      rows.push({
        pid: p.id,
        vid: '',
        label: p.title || '(untitled)',
        sku: p.sku,
        sold: data.soldQty(p.id, null),
        qty,
        orig: qty,
      });
    }
    groups.set(type, rows);
  }
  bulkGroups.value = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, rows]) => ({ type, rows, setAll: '' }));
  showBulk.value = true;
}

function bulkSetAll(group: BulkGroup): void {
  const n = Math.max(0, Math.floor(parseFloat(group.setAll)));
  if (Number.isNaN(n)) return;
  for (const row of group.rows) row.qty = n;
  group.setAll = '';
}

const bulkChanges = computed(() =>
  bulkGroups.value.reduce(
    (s, g) => s + g.rows.filter((r) => (Math.max(0, Math.floor(Number(r.qty)) || 0)) !== r.orig).length,
    0,
  ),
);

async function saveBulk(): Promise<void> {
  const eventId = settings.activeEventId;
  if (!eventId) return;
  let changed = 0;
  for (const group of bulkGroups.value) {
    for (const row of group.rows) {
      const qty = Math.max(0, Math.floor(Number(row.qty)) || 0);
      if (qty === row.orig) continue;
      await setStock(eventId, row.pid, row.vid, qty);
      changed++;
    }
  }
  showBulk.value = false;
  showToast(`Stock updated — ${changed} change${changed === 1 ? '' : 's'}`, 'success');
}

async function doDeleteProduct(): Promise<void> {
  if (!confirmDeleteId.value) return;
  await deleteProduct(confirmDeleteId.value);
  confirmDeleteId.value = null;
  editing.value = false;
  showToast('Product deleted', 'info');
}

// ── Discount editor ────────────────────────────────────────────────────────
const editingDiscount = ref(false);
const discountId = ref<string | null>(null);
const discountForm = reactive({
  name: '',
  type: 'bxgy' as DiscountRule['type'],
  productIds: [] as string[],
  /** Specific variants as "pid:vid" — only relevant when the product itself isn't selected. */
  variantIds: [] as string[],
  buyQty: '2',
  freeQty: '1',
  nth: '3',
  percent: '50',
  tiers: [] as { qty: string; total: string }[],
  tierContinue: false,
});

/** Other (non-deleted) rules that target any of the currently selected products/variants. */
const overlappingRules = computed(() =>
  data.discounts.filter(
    (d) =>
      d.id !== discountId.value &&
      (d.productIds.some((id) => discountForm.productIds.includes(id)) ||
        d.variantIds.some((id) => discountForm.variantIds.includes(id)) ||
        d.productIds.some((id) => discountForm.variantIds.some((v) => v.startsWith(`${id}:`))) ||
        d.variantIds.some((id) => discountForm.productIds.includes(id.split(':')[0]))),
  ),
);

function openNewDiscount(): void {
  discountId.value = null;
  discountForm.variantIds = [];
  Object.assign(discountForm, {
    name: '',
    type: 'bxgy',
    productIds: [],
    buyQty: '2',
    freeQty: '1',
    nth: '3',
    percent: '50',
    tiers: [{ qty: '3', total: '' }],
    tierContinue: false,
  });
  editingDiscount.value = true;
}

function openEditDiscount(d: DiscountRule): void {
  discountId.value = d.id;
  discountForm.variantIds = [...(d.variantIds ?? [])];
  Object.assign(discountForm, {
    name: d.name,
    type: d.type,
    productIds: [...d.productIds],
    buyQty: String(d.buyQty ?? 2),
    freeQty: String(d.freeQty ?? 1),
    nth: String(d.nth ?? 3),
    percent: String(d.percent ?? 50),
    tiers: (d.tiers ?? []).map((t) => ({ qty: String(t.qty), total: String(t.total) })),
    tierContinue: !!d.tierContinue,
  });
  editingDiscount.value = true;
}

async function saveDiscount(): Promise<void> {
  if (!discountForm.name.trim()) {
    showToast('Discount needs a name.', 'error');
    return;
  }
  if (!discountForm.productIds.length && !discountForm.variantIds.length) {
    showToast('Select at least one product or variant.', 'error');
    return;
  }
  const rule: DiscountRule = {
    id: discountId.value ?? uuidv7(),
    name: discountForm.name.trim(),
    type: discountForm.type,
    productIds: [...discountForm.productIds],
    // Variant targets covered by a selected product are redundant — drop them
    variantIds: discountForm.variantIds.filter((v) => !discountForm.productIds.includes(v.split(':')[0])),
    buyQty: parseInt(discountForm.buyQty) || 2,
    freeQty: parseInt(discountForm.freeQty) || 1,
    nth: parseInt(discountForm.nth) || 3,
    percent: parseFloat(discountForm.percent) || 50,
    tiers: discountForm.tiers
      .map((t) => ({ qty: parseInt(t.qty) || 0, total: parseFloat(t.total) || 0 }))
      .filter((t) => t.qty > 1 && t.total > 0),
    tierContinue: discountForm.tierContinue,
    updatedAt: Date.now(),
  };
  await upsertDiscount(rule);
  editingDiscount.value = false;
  showToast('Discount saved', 'success');
}

function discountSummary(d: DiscountRule): string {
  if (d.type === 'bxgy') return `Buy ${d.buyQty}, get ${d.freeQty} free`;
  if (d.type === 'nth_pct') return `Every ${d.nth} items, cheapest is ${d.percent}% off`;
  return (d.tiers ?? []).map((t) => `${t.qty} for ${t.total}`).join(' · ') || 'Tiered';
}
</script>

<template>
  <div class="mx-auto max-w-4xl p-4 md:p-6">
    <div class="mb-4 space-y-3">
      <div class="flex items-center justify-between gap-3">
        <h1 class="text-xl font-bold">Catalog</h1>
        <button
          class="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          @click="tab === 'products' ? openNew() : openNewDiscount()"
        >
          + New {{ tab === 'products' ? 'product' : 'discount' }}
        </button>
      </div>
      <div class="flex w-fit rounded-lg bg-slate-900 p-1 text-sm ring-1 ring-slate-800">
        <button
          class="rounded-md px-3 py-1"
          :class="tab === 'products' ? 'bg-slate-700 font-semibold' : 'text-slate-400'"
          @click="tab = 'products'"
        >
          Products
        </button>
        <button
          class="rounded-md px-3 py-1"
          :class="tab === 'discounts' ? 'bg-slate-700 font-semibold' : 'text-slate-400'"
          @click="tab = 'discounts'"
        >
          Discounts
        </button>
      </div>
    </div>

    <!-- Products tab -->
    <template v-if="tab === 'products'">
      <div class="mb-3 flex gap-2">
        <input
          v-model="search"
          placeholder="Search products…"
          class="min-w-0 flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm ring-1 ring-slate-800"
        />
        <button
          class="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium ring-1 ring-slate-800 hover:bg-slate-800 disabled:opacity-40"
          :disabled="!settings.activeEventId || !data.products.length"
          @click="openBulk"
        >
          📦 Bulk stock
        </button>
      </div>
      <p v-if="!data.activeEvent" class="mb-3 rounded-lg bg-amber-950/50 px-3 py-2 text-xs text-amber-400">
        No active event — stock quantities are per event, activate one under Events to edit them.
      </p>
      <div class="space-y-4">
        <section v-for="group in productGroups" :key="group.type">
          <div class="mb-1.5 flex items-center gap-2">
            <span class="h-4 w-1.5 rounded-full" :style="{ background: typeColor(group.type) }" />
            <h2 class="text-sm font-semibold" :style="{ color: typeColor(group.type) }">{{ group.type }}</h2>
            <span class="text-xs text-slate-500">{{ group.products.length }}</span>
          </div>
          <ul class="divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-800">
            <li
              v-for="p in group.products"
              :key="p.id"
              class="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-800/60"
              @click="openEdit(p)"
            >
              <ProductThumb :image-id="p.imageId" :type="p.type" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold">
                  {{ p.title || '(untitled)' }}
                  <span v-if="!p.forSale" class="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">not for sale</span>
                </p>
                <p class="truncate text-xs text-slate-500">
                  {{ p.sku }}<span v-if="p.variants.length"> · {{ p.variants.length }} variants</span>
                </p>
              </div>
              <div class="text-right text-sm">
                <p class="font-semibold">{{ fmtPrice(p.price, data.currency) }}</p>
                <p class="text-xs text-slate-500">
                  {{ data.stockLeft(p, null) }} left / {{ data.soldQty(p.id, null) + p.variants.reduce((s, v) => s + data.soldQty(p.id, v.id), 0) }} sold
                </p>
              </div>
            </li>
          </ul>
        </section>
      </div>
      <p v-if="!filteredProducts.length" class="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400">
        No products yet.
      </p>
    </template>

    <!-- Discounts tab -->
    <template v-else>
      <ul class="divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-800">
        <li
          v-for="d in data.discounts"
          :key="d.id"
          class="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-800/60"
          @click="openEditDiscount(d)"
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">{{ d.name }}</p>
            <p class="text-xs text-slate-500">{{ discountSummary(d) }} · {{ d.productIds.length }} product(s)</p>
          </div>
          <button
            class="rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-red-950"
            @click.stop="deleteDiscount(d.id)"
          >
            Delete
          </button>
        </li>
      </ul>
      <p v-if="!data.discounts.length" class="rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400">
        No discount rules. Create bundle deals like "buy 2 get 1 free" or "3 for 25".
      </p>
    </template>

    <!-- Product editor modal -->
    <ModalShell v-if="editing" :title="editId ? 'Edit product' : 'New product'" @close="editing = false">
      <div class="space-y-3">
        <!-- Photo -->
        <div class="flex items-center gap-3">
          <div class="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-800">
            <img v-if="imagePreview" :src="imagePreview" class="h-full w-full object-cover" />
            <ProductThumb
              v-else-if="editId && !removeImage"
              :image-id="data.products.find((p) => p.id === editId)?.imageId"
              :type="form.type"
              size="lg"
              class="!h-20 !w-20"
            />
            <div v-else class="flex h-full w-full items-center justify-center text-2xl">🖼️</div>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="cursor-pointer rounded-lg bg-slate-800 px-3 py-1.5 text-center text-xs font-medium hover:bg-slate-700">
              {{ imagePreview || (editId && data.products.find((p) => p.id === editId)?.imageId && !removeImage) ? 'Replace photo' : 'Add photo' }}
              <input type="file" accept="image/*" class="hidden" @change="pickImage" />
            </label>
            <button
              v-if="imagePreview || (editId && data.products.find((p) => p.id === editId)?.imageId && !removeImage)"
              class="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
              @click="
                removeImage = true;
                imageFile = null;
                imagePreview = null;
              "
            >
              Remove
            </button>
          </div>
        </div>

        <label class="block text-sm">
          <span class="text-slate-400">Title *</span>
          <input v-model="form.title" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-sm">
            <span class="text-slate-400">SKU</span>
            <input v-model="form.sku" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-slate-400">Type</span>
            <input v-model="form.type" list="type-suggestions" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
            <datalist id="type-suggestions">
              <option v-for="t in [...new Set(data.products.map((p) => p.type).filter(Boolean))]" :key="t" :value="t" />
            </datalist>
          </label>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <label class="block text-sm">
            <span class="text-slate-400">Price ({{ data.currency }})</span>
            <input v-model="form.price" type="number" step="0.05" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-slate-400">Weight (g)</span>
            <input v-model="form.weightG" type="number" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label v-if="!form.variants.length" class="block text-sm">
            <span class="text-slate-400">Stock (this event)</span>
            <input
              v-model.number="form.broughtQty"
              type="number"
              min="0"
              :disabled="!settings.activeEventId"
              class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 disabled:opacity-40"
            />
          </label>
        </div>
        <div class="flex gap-4 text-sm">
          <label class="flex items-center gap-2"><input v-model="form.forSale" type="checkbox" /> For sale</label>
          <label class="flex items-center gap-2"><input v-model="form.unlisted" type="checkbox" /> Unlisted (left off customs documents)</label>
        </div>

        <!-- Variants -->
        <div class="rounded-lg bg-slate-800/50 p-3">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-sm font-semibold">Variants</span>
            <button class="text-xs text-emerald-400" @click="addVariant">+ Add variant</button>
          </div>
          <div v-for="(v, i) in form.variants" :key="v.id" class="mb-2 grid grid-cols-[1fr_5rem_4rem_4rem_2rem] items-center gap-2">
            <input v-model="v.name" placeholder="Name" class="rounded-md bg-slate-800 px-2 py-1.5 text-sm" />
            <input v-model="v.sku" placeholder="SKU" class="rounded-md bg-slate-800 px-2 py-1.5 text-sm" />
            <input v-model="v.price" placeholder="Price" type="number" step="0.05" class="rounded-md bg-slate-800 px-2 py-1.5 text-sm" />
            <input
              v-model.number="v.broughtQty"
              placeholder="Stock"
              type="number"
              min="0"
              :disabled="!settings.activeEventId"
              class="rounded-md bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-40"
            />
            <button class="text-red-400" @click="form.variants.splice(i, 1)">✕</button>
          </div>
          <p v-if="!form.variants.length" class="text-xs text-slate-500">No variants — the product sells as-is.</p>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-between">
          <button
            v-if="editId"
            class="rounded-lg bg-red-950 px-4 py-2 text-sm text-red-400"
            @click="confirmDeleteId = editId"
          >
            Delete
          </button>
          <div class="ml-auto flex gap-2">
            <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm" @click="editing = false">Cancel</button>
            <button class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white" @click="saveProduct">
              Save
            </button>
          </div>
        </div>
      </template>
    </ModalShell>

    <!-- Bulk stock editor -->
    <ModalShell v-if="showBulk" title="Bulk stock" @close="showBulk = false">
      <p class="mb-3 text-xs text-slate-400">
        Brought quantities for <b>{{ data.activeEvent?.name }}</b>, grouped by type. "Set all" fills
        every row of a group at once.
      </p>
      <div class="space-y-4">
        <div v-for="group in bulkGroups" :key="group.type">
          <div class="mb-1.5 flex items-center gap-2">
            <span class="h-4 w-1.5 rounded-full" :style="{ background: typeColor(group.type) }" />
            <span class="text-sm font-semibold">{{ group.type }}</span>
            <span class="text-xs text-slate-500">{{ group.rows.length }}</span>
            <div class="ml-auto flex items-center gap-1">
              <input
                v-model="group.setAll"
                type="number"
                min="0"
                placeholder="Set all"
                class="w-20 rounded-md bg-slate-800 px-2 py-1 text-sm"
                @keydown.enter="bulkSetAll(group)"
              />
              <button
                class="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium hover:bg-slate-700 disabled:opacity-40"
                :disabled="!group.setAll"
                @click="bulkSetAll(group)"
              >
                Apply
              </button>
            </div>
          </div>
          <ul class="divide-y divide-slate-800 overflow-hidden rounded-lg bg-slate-800/40 ring-1 ring-slate-800">
            <li
              v-for="row in group.rows"
              :key="row.pid + ':' + row.vid"
              class="flex items-center gap-2 px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm">{{ row.label }}</p>
                <p class="text-[11px] text-slate-500">
                  <span v-if="row.sku">{{ row.sku }} · </span>{{ row.sold }} sold
                </p>
              </div>
              <input
                v-model.number="row.qty"
                type="number"
                min="0"
                class="w-20 rounded-md px-2 py-1.5 text-right text-sm"
                :class="(Math.max(0, Math.floor(Number(row.qty)) || 0)) !== row.orig ? 'bg-emerald-950 ring-1 ring-emerald-600' : 'bg-slate-800'"
              />
            </li>
          </ul>
        </div>
      </div>
      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <span v-if="bulkChanges" class="mr-auto text-xs text-slate-400">
            {{ bulkChanges }} change{{ bulkChanges === 1 ? '' : 's' }}
          </span>
          <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm" @click="showBulk = false">Cancel</button>
          <button
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            :disabled="!bulkChanges"
            @click="saveBulk"
          >
            Save stock
          </button>
        </div>
      </template>
    </ModalShell>

    <!-- Delete confirm -->
    <ModalShell v-if="confirmDeleteId" title="Delete product?" @close="confirmDeleteId = null">
      <p class="text-sm text-slate-300">
        The product disappears from the catalog and POS. Past sales keep their records.
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm" @click="confirmDeleteId = null">Cancel</button>
          <button class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white" @click="doDeleteProduct">
            Delete
          </button>
        </div>
      </template>
    </ModalShell>

    <!-- Discount editor modal -->
    <ModalShell
      v-if="editingDiscount"
      :title="discountId ? 'Edit discount' : 'New discount'"
      @close="editingDiscount = false"
    >
      <div class="space-y-3">
        <label class="block text-sm">
          <span class="text-slate-400">Name *</span>
          <input v-model="discountForm.name" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Type</span>
          <select v-model="discountForm.type" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2">
            <option value="bxgy">Buy X get Y free</option>
            <option value="nth_pct">Every Nth item % off</option>
            <option value="tiered">Tiered (e.g. 3 for 25)</option>
          </select>
        </label>

        <div v-if="discountForm.type === 'bxgy'" class="grid grid-cols-2 gap-3">
          <label class="block text-sm">
            <span class="text-slate-400">Buy</span>
            <input v-model="discountForm.buyQty" type="number" min="1" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-slate-400">Get free</span>
            <input v-model="discountForm.freeQty" type="number" min="1" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
        </div>

        <div v-else-if="discountForm.type === 'nth_pct'" class="grid grid-cols-2 gap-3">
          <label class="block text-sm">
            <span class="text-slate-400">Every Nth item</span>
            <input v-model="discountForm.nth" type="number" min="2" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
          <label class="block text-sm">
            <span class="text-slate-400">% off</span>
            <input v-model="discountForm.percent" type="number" min="1" max="100" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
          </label>
        </div>

        <div v-else class="space-y-2">
          <div v-for="(t, i) in discountForm.tiers" :key="i" class="flex items-center gap-2 text-sm">
            <input v-model="t.qty" type="number" min="2" placeholder="Qty" class="w-20 rounded-lg bg-slate-800 px-3 py-2" />
            <span class="text-slate-400">for</span>
            <input v-model="t.total" type="number" step="0.05" placeholder="Total" class="w-24 rounded-lg bg-slate-800 px-3 py-2" />
            <button class="text-red-400" @click="discountForm.tiers.splice(i, 1)">✕</button>
          </div>
          <button class="text-xs text-emerald-400" @click="discountForm.tiers.push({ qty: '', total: '' })">
            + Add tier
          </button>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="discountForm.tierContinue" type="checkbox" />
            Continue tier price for remainder items
          </label>
        </div>

        <div class="rounded-lg bg-slate-800/50 p-3">
          <span class="text-sm font-semibold">Applies to</span>
          <div class="mt-2 max-h-48 space-y-1 overflow-y-auto">
            <template v-for="p in data.products" :key="p.id">
              <label class="flex items-center gap-2 text-sm">
                <input v-model="discountForm.productIds" type="checkbox" :value="p.id" />
                {{ p.title || '(untitled)' }}
              </label>
              <label
                v-for="v in p.variants"
                v-show="!discountForm.productIds.includes(p.id)"
                :key="v.id"
                class="ml-6 flex items-center gap-2 text-xs text-slate-400"
              >
                <input v-model="discountForm.variantIds" type="checkbox" :value="`${p.id}:${v.id}`" />
                {{ v.name || v.id }}
              </label>
            </template>
          </div>
          <p v-if="overlappingRules.length" class="mt-2 text-xs text-amber-400">
            ⚠ Also targeted by
            {{ overlappingRules.map((d) => `"${d.name}"`).join(', ') }} — discounts on the same items stack.
          </p>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm" @click="editingDiscount = false">Cancel</button>
          <button class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white" @click="saveDiscount">
            Save
          </button>
        </div>
      </template>
    </ModalShell>
  </div>
</template>
