<script setup lang="ts">
import { computed, ref } from 'vue';
import { CURRENCIES, CURRENCY_BY_CODE } from '@/lib/currencies';

/**
 * Type-ahead currency picker (mirrors CountryPicker): search by code prefix or
 * name substring, pick from the dropdown. The model is always the 3-letter ISO
 * code (e.g. "EUR"). Typed input is normalised to a known code on blur.
 */
const props = withDefaults(defineProps<{ modelValue: string; placeholder?: string }>(), { placeholder: '' });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const open = ref(false);
const focusIdx = ref(-1);

const matches = computed(() => {
  const q = props.modelValue.trim().toLowerCase();
  const list = q
    ? CURRENCIES.filter((c) => c.code.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q))
    : CURRENCIES;
  return list.slice(0, 80);
});

function select(c: { code: string; name: string }): void {
  emit('update:modelValue', c.code);
  open.value = false;
}
function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).value.toUpperCase());
  open.value = true;
  focusIdx.value = -1;
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    open.value = false;
    return;
  }
  if (!open.value || !matches.value.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusIdx.value = Math.min(focusIdx.value + 1, matches.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusIdx.value = Math.max(focusIdx.value - 1, 0);
  } else if (e.key === 'Enter' && focusIdx.value >= 0) {
    e.preventDefault();
    select(matches.value[focusIdx.value]!);
  }
}
function onBlur(): void {
  setTimeout(() => (open.value = false), 160);
  const val = props.modelValue.trim().toUpperCase();
  if (!val) return;
  // Snap to a known code, or a code matched by exact name; otherwise keep as typed.
  if (CURRENCY_BY_CODE[val]) {
    emit('update:modelValue', val);
    return;
  }
  const byName = CURRENCIES.find((c) => c.name.toLowerCase() === props.modelValue.trim().toLowerCase());
  if (byName) emit('update:modelValue', byName.code);
}
</script>

<template>
  <div class="relative">
    <input
      :value="modelValue"
      :placeholder="placeholder"
      class="w-full zui-input uppercase"
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      @input="onInput"
      @focus="open = true"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <div
      v-if="open && matches.length"
      class="absolute inset-x-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg bg-slate-800 shadow-xl ring-1 ring-slate-600"
    >
      <button
        v-for="(c, i) in matches"
        :key="c.code"
        type="button"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-700"
        :class="{ 'bg-slate-700': i === focusIdx }"
        @mousedown.prevent="select(c)"
      >
        <span class="w-10 shrink-0 font-mono text-xs text-emerald-400">{{ c.code }}</span>
        <span class="truncate">{{ c.name }}</span>
      </button>
    </div>
  </div>
</template>
