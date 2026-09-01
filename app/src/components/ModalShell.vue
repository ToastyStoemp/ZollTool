<script setup lang="ts">
import { computed } from 'vue';
import { X } from 'lucide-vue-next';

const props = defineProps<{ title: string; size?: 'lg' | 'xl' | '2xl' | '3xl' }>();
const emit = defineEmits<{ close: [] }>();

const maxWidth = computed(
  () => ({ lg: 'max-w-lg', xl: 'max-w-xl', '2xl': 'max-w-2xl', '3xl': 'max-w-3xl' })[props.size ?? 'lg'],
);
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-end justify-center bg-black/75 sm:items-center"
    @click.self="emit('close')"
  >
    <div
      class="modal-card flex w-full flex-col rounded-t-2xl bg-slate-900 pb-[var(--safe-bottom)] shadow-xl ring-1 ring-slate-700 sm:rounded-2xl sm:pb-0"
      :class="maxWidth"
    >
      <header class="flex items-center justify-between border-b border-slate-800 px-5 py-4">
        <h2 class="text-lg font-semibold">{{ title }}</h2>
        <button
          class="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          @click="emit('close')"
        >
          <X class="h-5 w-5" />
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto p-5">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="border-t border-slate-800 px-5 py-4">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>
