<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next';

/** Shared chrome for a Settings sub-page: back arrow + title + a stacked slot. */
defineProps<{ title: string }>();
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 md:p-6">
    <div class="mb-5 flex items-center gap-3">
      <RouterLink
        to="/settings"
        class="rounded-lg bg-slate-800 p-2 text-slate-300 hover:bg-slate-700"
        aria-label="Back to Settings"
      >
        <ChevronLeft class="h-5 w-5" />
      </RouterLink>
      <h1 class="text-xl font-bold">{{ title }}</h1>
    </div>
    <div class="space-y-6">
      <slot />
    </div>
  </div>
</template>
