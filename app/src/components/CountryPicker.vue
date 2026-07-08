<script setup lang="ts">
import { computed, ref } from 'vue';
import { COUNTRIES, COUNTRY_BY_CODE } from '@/customs/data';

/**
 * Type-ahead country input, ported from the legacy app's initCountryPicker():
 * search by code prefix or name substring, pick from the dropdown, and typed
 * values are normalised on blur (mode 'name' → "Switzerland", 'code' → "CH").
 */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** 'name' stores the full country name, 'code' the 2-letter ISO code. */
    mode?: 'name' | 'code';
    placeholder?: string;
  }>(),
  { mode: 'name', placeholder: '' },
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const open = ref(false);
const focusIdx = ref(-1);

const matches = computed(() => {
  const q = props.modelValue.trim().toLowerCase();
  const list = q
    ? COUNTRIES.filter((c) => c.code.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q))
    : COUNTRIES;
  return list.slice(0, 80);
});

function select(country: { code: string; name: string }): void {
  emit('update:modelValue', props.mode === 'code' ? country.code : country.name);
  open.value = false;
}

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).value);
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
  // Delay so a mousedown on a dropdown item still lands
  setTimeout(() => (open.value = false), 160);
  const val = props.modelValue.trim();
  if (!val) return;
  const asCode = COUNTRY_BY_CODE[val.toUpperCase()] ? val.toUpperCase() : null;
  const byName = COUNTRIES.find((c) => c.name.toLowerCase() === val.toLowerCase());
  if (props.mode === 'name') {
    if (asCode) emit('update:modelValue', COUNTRY_BY_CODE[asCode]!);
    else if (byName) emit('update:modelValue', byName.name);
  } else {
    if (asCode) emit('update:modelValue', asCode);
    else if (byName) emit('update:modelValue', byName.code);
  }
}
</script>

<template>
  <div class="relative">
    <input
      :value="modelValue"
      :placeholder="placeholder"
      class="w-full rounded-lg bg-slate-800 px-3 py-2"
      autocomplete="off"
      autocapitalize="off"
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
        <span class="w-8 shrink-0 font-mono text-xs text-emerald-400">{{ c.code }}</span>
        <span class="truncate">{{ c.name }}</span>
      </button>
    </div>
  </div>
</template>
