<script setup lang="ts">
import { computed, ref } from 'vue';
import { HS_CODES } from '@/customs/data';

/**
 * HS/tariff-code combobox, ported from the legacy app's initHsCombobox():
 * search by code or description, pick to fill the code; the matched
 * description shows as a hint under the field.
 */
const props = defineProps<{ modelValue: string; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const open = ref(false);
const focusIdx = ref(-1);

const matches = computed(() => {
  const q = props.modelValue.trim().toLowerCase();
  if (!q) return [];
  return HS_CODES.filter(
    (h) => h.code.toLowerCase().includes(q) || h.desc.toLowerCase().includes(q),
  ).slice(0, 40);
});

const hint = computed(() => HS_CODES.find((h) => h.code === props.modelValue.trim())?.desc ?? '');

function select(entry: { code: string; desc: string }): void {
  emit('update:modelValue', entry.code);
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
}
</script>

<template>
  <div class="relative">
    <input
      :value="modelValue"
      :placeholder="placeholder"
      class="w-full rounded-lg bg-slate-800 px-3 py-2 font-mono text-sm"
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
        v-for="(h, i) in matches"
        :key="h.code"
        type="button"
        class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-700"
        :class="{ 'bg-slate-700': i === focusIdx }"
        @mousedown.prevent="select(h)"
      >
        <span class="shrink-0 font-mono text-xs text-emerald-400">{{ h.code }}</span>
        <span class="truncate text-xs text-slate-300">{{ h.desc }}</span>
      </button>
    </div>
    <p v-if="hint" class="mt-1 truncate text-[11px] text-slate-500">{{ hint }}</p>
  </div>
</template>
