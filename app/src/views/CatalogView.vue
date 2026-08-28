<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { DiscountRule, Product, Variant } from '@zolltool/shared';
import { useDataStore } from '@/stores/data';
import { useSettingsStore } from '@/stores/settings';
import { deleteDiscount, deleteProduct, setStock, upsertDiscount, upsertProduct } from '@/db/repo';
import { uuidv7 } from '@/lib/uuid';
import { fmtPrice } from '@/lib/money';
import { typeColor } from '@/lib/search';
import { ArrowDown, ArrowUp, Boxes, Camera, FileDown, Image as ImageIcon, ListOrdered, TriangleAlert, X } from 'lucide-vue-next';
import { saveTextFile } from '@/lib/download';
import { showToast } from '@/lib/toast';
import { saveProductImage } from '@/lib/images';
import ModalShell from '@/components/ModalShell.vue';
import ProductThumb from '@/components/ProductThumb.vue';
import CountryPicker from '@/components/CountryPicker.vue';
import TariffPicker from '@/components/TariffPicker.vue';

const data = useDataStore();
const settings = useSettingsStore();

const tab = ref<'products' | 'discounts'>('products');
const search = ref('');

// ── Product editor ─────────────────────────────────────────────────────────
interface VariantForm extends Variant {
  broughtQty: number;
  /** Transient photo pick-state — stripped on save (see saveProduct). */
  newImage?: File;
  previewUrl?: string;
  removeImage?: boolean;
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

// ── Low-stock view: what needs restocking at the active event ──────────────
const lowStockOnly = ref(false);
const lowStockThreshold = ref('3');

/** left = brought − sold, per product or per variant. */
function lowStockRows(p: Product): Array<{ variant: string; left: number; brought: number; sold: number }> {
  const thr = Math.max(0, parseInt(lowStockThreshold.value) || 0);
  const rows: Array<{ variant: string; left: number; brought: number; sold: number }> = [];
  if (p.variants.length) {
    for (const v of p.variants) {
      const brought = data.broughtQty(p.id, v.id);
      const sold = data.soldQty(p.id, v.id);
      if (brought - sold <= thr) rows.push({ variant: v.name || v.id, left: brought - sold, brought, sold });
    }
  } else {
    const brought = data.broughtQty(p.id, null);
    const sold = data.soldQty(p.id, null);
    if (brought - sold <= thr) rows.push({ variant: '', left: brought - sold, brought, sold });
  }
  return rows;
}

const filteredProducts = computed(() => {
  const needle = search.value.trim().toLowerCase();
  let list = data.products;
  if (needle) {
    list = list.filter((p) =>
      [p.title, p.sku, p.type].filter(Boolean).join(' ').toLowerCase().includes(needle),
    );
  }
  if (lowStockOnly.value && settings.activeEventId) {
    list = list.filter((p) => lowStockRows(p).length > 0);
  }
  return list;
});

/** Export the current low-stock list as a restock CSV. */
async function exportRestockCsv(): Promise<void> {
  const rows = [['Product', 'Variant', 'Type', 'SKU', 'Brought', 'Sold', 'Left']];
  for (const p of filteredProducts.value) {
    for (const r of lowStockRows(p)) {
      rows.push([p.title, r.variant, p.type ?? '', p.sku ?? '', String(r.brought), String(r.sold), String(r.left)]);
    }
  }
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
  await saveTextFile(`restock_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
}

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

// ── Reorder: move products within the global sortOrder (drives the POS grid) ─
const showReorder = ref(false);

async function moveProduct(pid: string, dir: -1 | 1): Promise<void> {
  const list = [...data.products];
  const i = list.findIndex((p) => p.id === pid);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= list.length) return;
  const [moved] = list.splice(i, 1);
  list.splice(j, 0, moved!);
  // Renumber sequentially; only products whose position changed are written
  // (first use may normalize legacy duplicate sortOrders once).
  const now = Date.now();
  for (let k = 0; k < list.length; k++) {
    const p = list[k]!;
    if (p.sortOrder !== k) await upsertProduct({ ...p, sortOrder: k, updatedAt: now });
  }
}

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

// ── Variant photos ──────────────────────────────────────────────────────────
function pickVariantImage(v: VariantForm, e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  if (v.previewUrl) URL.revokeObjectURL(v.previewUrl);
  v.newImage = file;
  v.previewUrl = URL.createObjectURL(file);
  v.removeImage = false;
}

function removeVariantImage(v: VariantForm): void {
  if (v.previewUrl) URL.revokeObjectURL(v.previewUrl);
  v.newImage = undefined;
  v.previewUrl = undefined;
  v.removeImage = true;
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
    variants: await Promise.all(
      form.variants.map(async ({ broughtQty, newImage, previewUrl, removeImage: rmImage, ...v }) => ({
        ...v,
        name: v.name.trim(),
        sku: v.sku?.trim() || undefined,
        price: v.price != null && String(v.price) !== '' ? Number(v.price) : undefined,
        imageId: rmImage
          ? undefined
          : newImage
            ? await saveProductImage(productId, newImage)
            : v.imageId,
      })),
    ),
    imageId,
    sortOrder: existing?.sortOrder ?? data.products.length,
    updatedAt: Date.now(),
  };
  // Helpers may only change stock — never the product itself (server rejects it
  // anyway; skipping the upsert avoids a failed sync push).
  if (!settings.isHelper) await upsertProduct(product);

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
  /** Product types — the rule then covers every product of that type. */
  productTypes: [] as string[],
  buyQty: '2',
  freeQty: '1',
  nth: '3',
  percent: '50',
  tiers: [] as { qty: string; total: string }[],
  tierContinue: false,
  hideQuickAdd: false,
  comboDiscountAmount: '',
});

/** Distinct product types available as discount targets. */
const discountableTypes = computed(() =>
  [...new Set(data.products.map((p) => p.type).filter((t): t is string => !!t))].sort(),
);

/** Search filter for the target list — long catalogs are painful to scroll. */
const discountSearch = ref('');
const discountProductList = computed(() => {
  const needle = discountSearch.value.trim().toLowerCase();
  if (!needle) return data.products;
  return data.products.filter((p) =>
    [p.title, p.sku, p.type, ...p.variants.flatMap((v) => [v.name, v.sku])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
});

const discountTargetCount = computed(
  () => discountForm.productTypes.length + discountForm.productIds.length + discountForm.variantIds.length,
);

function typeOf(pid: string): string | undefined {
  return data.products.find((p) => p.id === pid)?.type;
}

/** Everything the current form covers, resolved down to product ids + types. */
function formCoversProduct(pid: string): boolean {
  const t = typeOf(pid);
  return discountForm.productIds.includes(pid) || (!!t && discountForm.productTypes.includes(t));
}

/** Other (non-deleted) rules that target any of the currently selected products/variants/types. */
const overlappingRules = computed(() =>
  data.discounts.filter(
    (d) =>
      d.id !== discountId.value &&
      (d.productIds.some((id) => formCoversProduct(id)) ||
        d.variantIds.some((id) => discountForm.variantIds.includes(id)) ||
        d.productIds.some((id) => discountForm.variantIds.some((v) => v.startsWith(`${id}:`))) ||
        d.variantIds.some((id) => formCoversProduct(id.split(':')[0])) ||
        (d.productTypes ?? []).some(
          (t) =>
            discountForm.productTypes.includes(t) ||
            discountForm.productIds.some((pid) => typeOf(pid) === t) ||
            discountForm.variantIds.some((v) => typeOf(v.split(':')[0]) === t),
        )),
  ),
);

function openNewDiscount(): void {
  discountId.value = null;
  discountSearch.value = '';
  discountForm.variantIds = [];
  Object.assign(discountForm, {
    name: '',
    type: 'bxgy',
    productIds: [],
    productTypes: [],
    buyQty: '2',
    freeQty: '1',
    nth: '3',
    percent: '50',
    tiers: [{ qty: '3', total: '' }],
    tierContinue: false,
    hideQuickAdd: false,
    comboDiscountAmount: '',
  });
  editingDiscount.value = true;
}

function openEditDiscount(d: DiscountRule): void {
  discountId.value = d.id;
  discountSearch.value = '';
  discountForm.variantIds = [...(d.variantIds ?? [])];
  Object.assign(discountForm, {
    name: d.name,
    type: d.type,
    productIds: [...d.productIds],
    productTypes: [...(d.productTypes ?? [])],
    buyQty: String(d.buyQty ?? 2),
    freeQty: String(d.freeQty ?? 1),
    nth: String(d.nth ?? 3),
    percent: String(d.percent ?? 50),
    tiers: (d.tiers ?? []).map((t) => ({ qty: String(t.qty), total: String(t.total) })),
    tierContinue: !!d.tierContinue,
    hideQuickAdd: !!d.hideQuickAdd,
    comboDiscountAmount: d.comboDiscountAmount ? String(d.comboDiscountAmount) : '',
  });
  editingDiscount.value = true;
}

async function saveDiscount(): Promise<void> {
  if (!discountForm.name.trim()) {
    showToast('Discount needs a name.', 'error');
    return;
  }
  if (!discountForm.productIds.length && !discountForm.variantIds.length && !discountForm.productTypes.length) {
    showToast('Select at least one product type, product or variant.', 'error');
    return;
  }
  if (discountForm.type === 'combo' && discountTargetCount.value < 2) {
    showToast('A bundle needs at least two members (products, variants or types).', 'error');
    return;
  }
  if (discountForm.type === 'combo' && !(parseFloat(discountForm.comboDiscountAmount) > 0)) {
    showToast('Enter a bundle discount amount.', 'error');
    return;
  }
  const rule: DiscountRule = {
    id: discountId.value ?? uuidv7(),
    name: discountForm.name.trim(),
    type: discountForm.type,
    // Targets covered by a selected type are redundant — drop them
    productIds: discountForm.productIds.filter((id) => {
      const t = typeOf(id);
      return !t || !discountForm.productTypes.includes(t);
    }),
    // Variant targets covered by a selected product or type are redundant — drop them
    variantIds: discountForm.variantIds.filter((v) => !formCoversProduct(v.split(':')[0])),
    productTypes: [...discountForm.productTypes],
    buyQty: parseInt(discountForm.buyQty) || 2,
    freeQty: parseInt(discountForm.freeQty) || 1,
    nth: parseInt(discountForm.nth) || 3,
    percent: parseFloat(discountForm.percent) || 50,
    tiers: discountForm.tiers
      .map((t) => ({ qty: parseInt(t.qty) || 0, total: parseFloat(t.total) || 0 }))
      .filter((t) => t.qty > 1 && t.total > 0),
    tierContinue: discountForm.tierContinue,
    hideQuickAdd: discountForm.hideQuickAdd || undefined,
    comboDiscountAmount: parseFloat(discountForm.comboDiscountAmount) || 0,
    updatedAt: Date.now(),
  };
  await upsertDiscount(rule);
  editingDiscount.value = false;
  showToast('Discount saved', 'success');
}

function discountSummary(d: DiscountRule): string {
  if (d.type === 'bxgy') return `Buy ${d.buyQty}, get ${d.freeQty} free`;
  if (d.type === 'nth_pct') return `Every ${d.nth} items, cheapest is ${d.percent}% off`;
  if (d.type === 'combo') return `Bundle: −${d.comboDiscountAmount} when all present`;
  return (d.tiers ?? []).map((t) => `${t.qty} for ${t.total}`).join(' · ') || 'Tiered';
}

function discountTargets(d: DiscountRule): string {
  const parts: string[] = [];
  if (d.productTypes?.length) parts.push(`type ${d.productTypes.join(', ')}`);
  const count = d.productIds.length + (d.variantIds?.length ?? 0);
  if (count) parts.push(`${count} product(s)`);
  return parts.join(' + ') || 'no targets';
}
</script>

<template>
  <div class="mx-auto max-w-4xl p-4 md:p-6 xl:max-w-6xl">
    <div class="mb-4 space-y-3">
      <div class="flex items-center justify-between gap-3">
        <h1 class="text-xl font-bold">Catalog</h1>
        <button
          v-if="!settings.isHelper"
          class="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          @click="tab === 'products' ? openNew() : openNewDiscount()"
        >
          + New {{ tab === 'products' ? 'product' : 'discount' }}
        </button>
      </div>
      <p v-if="settings.isHelper" class="rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-400 ring-1 ring-slate-800">
        You can update <strong class="text-slate-200">stock</strong> for your event — prices and discounts are managed by the account owner.
      </p>
      <div v-if="!settings.isHelper" class="flex w-fit rounded-lg bg-slate-900 p-1 text-sm ring-1 ring-slate-800">
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
          <span class="flex items-center gap-1.5"><Boxes class="h-4 w-4" /> Bulk stock</span>
        </button>
        <button
          class="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
          :disabled="!data.products.length"
          @click="showReorder = true"
        >
          <span class="flex items-center gap-1.5"><ListOrdered class="h-4 w-4" /> Reorder</span>
        </button>
      </div>

      <!-- Low-stock filter (per active event) -->
      <div v-if="data.activeEvent" class="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label class="flex items-center gap-2 text-slate-300">
          <input v-model="lowStockOnly" type="checkbox" />
          Low stock only
        </label>
        <template v-if="lowStockOnly">
          <label class="flex items-center gap-1.5 text-xs text-slate-400">
            ≤
            <input
              v-model="lowStockThreshold"
              type="number"
              min="0"
              class="w-14 rounded-md bg-slate-800 px-2 py-1 text-sm"
            />
            left
          </label>
          <button
            class="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700 disabled:opacity-40"
            :disabled="!filteredProducts.length"
            @click="exportRestockCsv"
          >
            <FileDown class="h-3.5 w-3.5" /> Restock CSV
          </button>
        </template>
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
            <p class="text-xs text-slate-500">{{ discountSummary(d) }} · {{ discountTargets(d) }}</p>
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
            <div v-else class="flex h-full w-full items-center justify-center text-slate-500"><ImageIcon class="h-7 w-7" /></div>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-center text-xs font-medium hover:bg-slate-700">
              <Camera class="h-3.5 w-3.5" /> Take photo
              <!-- capture opens the camera directly on Android/iOS; ignored on desktop -->
              <input type="file" accept="image/*" capture="environment" class="hidden" @change="pickImage" />
            </label>
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
            <input v-model="form.price" type="number" step="0.05" :disabled="settings.isHelper" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 disabled:opacity-40" />
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
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-sm">
            <span class="text-slate-400">Tariff no. (HS code)</span>
            <TariffPicker v-model="form.tariffNo" placeholder="e.g. 4911.9100" class="mt-1" />
          </label>
          <label class="block text-sm">
            <span class="text-slate-400">Origin country</span>
            <CountryPicker v-model="form.originCountry" mode="code" placeholder="Artist's country" class="mt-1" />
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
            <button v-if="!settings.isHelper" class="text-xs text-emerald-400" @click="addVariant">+ Add variant</button>
          </div>
          <div v-for="(v, i) in form.variants" :key="v.id" class="mb-2 grid grid-cols-[2.5rem_1fr_5rem_4rem_4rem_2rem] items-center gap-2">
            <!-- Variant photo: tap to pick/replace; ✕ removes. Falls back to the product photo when unset. -->
            <label class="relative h-10 w-10 cursor-pointer">
              <img v-if="v.previewUrl" :src="v.previewUrl" class="h-10 w-10 rounded-lg object-cover" />
              <ProductThumb v-else-if="v.imageId && !v.removeImage" :image-id="v.imageId" :type="form.type" />
              <div v-else class="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 text-slate-400"><Camera class="h-4 w-4" /></div>
              <input type="file" accept="image/*" class="hidden" @change="pickVariantImage(v, $event)" />
              <button
                v-if="v.previewUrl || (v.imageId && !v.removeImage)"
                class="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white"
                title="Remove photo"
                @click.prevent.stop="removeVariantImage(v)"
              >
                <X class="h-2.5 w-2.5" />
              </button>
            </label>
            <input v-model="v.name" placeholder="Name" :disabled="settings.isHelper" class="rounded-md bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-40" />
            <input v-model="v.sku" placeholder="SKU" :disabled="settings.isHelper" class="rounded-md bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-40" />
            <input v-model="v.price" placeholder="Price" type="number" step="0.05" :disabled="settings.isHelper" class="rounded-md bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-40" />
            <input
              v-model.number="v.broughtQty"
              placeholder="Stock"
              type="number"
              min="0"
              :disabled="!settings.activeEventId"
              class="rounded-md bg-slate-800 px-2 py-1.5 text-sm disabled:opacity-40"
            />
            <button v-if="!settings.isHelper" class="text-red-400" @click="form.variants.splice(i, 1)"><X class="h-4 w-4" /></button>
          </div>
          <p v-if="!form.variants.length" class="text-xs text-slate-500">No variants — the product sells as-is.</p>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-between">
          <button
            v-if="editId && !settings.isHelper"
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

    <!-- Reorder products (drives the POS grid order) -->
    <ModalShell v-if="showReorder" title="Reorder products" @close="showReorder = false">
      <p class="mb-3 text-xs text-slate-500">
        This order is used by the POS grid and the catalog. Changes sync to all devices.
      </p>
      <ul class="divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-800/40 ring-1 ring-slate-800">
        <li v-for="(p, i) in data.products" :key="p.id" class="flex items-center gap-3 px-3 py-2">
          <ProductThumb :image-id="p.imageId" :type="p.type" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm">{{ p.title || '(untitled)' }}</p>
            <p v-if="p.type" class="text-[11px]" :style="{ color: typeColor(p.type) }">{{ p.type }}</p>
          </div>
          <button
            class="rounded-lg bg-slate-800 p-2 disabled:opacity-30"
            :disabled="i === 0"
            @click="moveProduct(p.id, -1)"
          >
            <ArrowUp class="h-4 w-4" />
          </button>
          <button
            class="rounded-lg bg-slate-800 p-2 disabled:opacity-30"
            :disabled="i === data.products.length - 1"
            @click="moveProduct(p.id, 1)"
          >
            <ArrowDown class="h-4 w-4" />
          </button>
        </li>
      </ul>
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
            <option value="combo">Bundle (all items must be present)</option>
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

        <div v-else-if="discountForm.type === 'tiered'" class="space-y-2">
          <div v-for="(t, i) in discountForm.tiers" :key="i" class="flex items-center gap-2 text-sm">
            <input v-model="t.qty" type="number" min="2" placeholder="Qty" class="w-20 rounded-lg bg-slate-800 px-3 py-2" />
            <span class="text-slate-400">for</span>
            <input v-model="t.total" type="number" step="0.05" placeholder="Total" class="w-24 rounded-lg bg-slate-800 px-3 py-2" />
            <button class="text-red-400" @click="discountForm.tiers.splice(i, 1)"><X class="h-4 w-4" /></button>
          </div>
          <button class="text-xs text-emerald-400" @click="discountForm.tiers.push({ qty: '', total: '' })">
            + Add tier
          </button>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="discountForm.tierContinue" type="checkbox" />
            Continue tier price for remainder items
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="discountForm.hideQuickAdd" type="checkbox" />
            Hide the +N quick-add buttons on the POS cards
          </label>
        </div>

        <div v-else-if="discountForm.type === 'combo'" class="space-y-2">
          <p class="text-xs text-slate-500">
            Triggers once for every complete set of the selected products/variants/types found in
            the cart — e.g. 2 purses + 3 wallets makes 2 bundles, one wallet left unbundled. Pick
            at least two members below.
          </p>
          <label class="block text-sm">
            <span class="text-slate-400">Bundle discount amount ({{ data.currency }}, off the total per bundle)</span>
            <input
              v-model="discountForm.comboDiscountAmount"
              type="number"
              min="0"
              step="0.05"
              class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
            />
          </label>
        </div>

        <div class="rounded-lg bg-slate-800/50 p-3">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold">{{ discountForm.type === 'combo' ? 'Bundle members (all required)' : 'Applies to' }}</span>
            <span v-if="discountTargetCount" class="text-xs text-emerald-400">{{ discountTargetCount }} selected</span>
          </div>

          <!-- Whole product types (covers current and future products of that type) -->
          <div v-if="discountableTypes.length" class="mt-2 space-y-1 border-b border-slate-700 pb-2">
            <label v-for="t in discountableTypes" :key="t" class="flex items-center gap-2 text-sm">
              <input v-model="discountForm.productTypes" type="checkbox" :value="t" />
              <span :style="{ color: typeColor(t) }" class="font-medium">{{ t }}</span>
              <span class="text-xs text-slate-500">
                — all {{ data.products.filter((p) => p.type === t).length }} products of this type
              </span>
            </label>
          </div>

          <input
            v-model="discountSearch"
            placeholder="Search products…"
            class="mt-2 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <div class="mt-2 max-h-[45vh] space-y-1 overflow-y-auto">
            <p v-if="!discountProductList.length" class="text-xs text-slate-500">No products match.</p>
            <template v-for="p in discountProductList" :key="p.id">
              <label
                v-show="!(p.type && discountForm.productTypes.includes(p.type))"
                class="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-800"
              >
                <input v-model="discountForm.productIds" type="checkbox" :value="p.id" />
                <span class="min-w-0 flex-1 truncate">{{ p.title || '(untitled)' }}</span>
                <span v-if="p.type" class="shrink-0 text-[10px]" :style="{ color: typeColor(p.type) }">{{ p.type }}</span>
              </label>
              <label
                v-for="v in p.variants"
                v-show="!formCoversProduct(p.id)"
                :key="v.id"
                class="ml-6 flex items-center gap-2 rounded px-1 py-0.5 text-xs text-slate-400 hover:bg-slate-800"
              >
                <input v-model="discountForm.variantIds" type="checkbox" :value="`${p.id}:${v.id}`" />
                {{ v.name || v.id }}
              </label>
            </template>
          </div>
          <p v-if="overlappingRules.length" class="mt-2 flex items-start gap-1.5 text-xs text-amber-400">
            <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Also targeted by {{ overlappingRules.map((d) => `"${d.name}"`).join(', ') }} — discounts
              on the same items stack.
            </span>
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
