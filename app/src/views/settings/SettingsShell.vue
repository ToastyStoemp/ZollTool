<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next';

/** Shared chrome for a Settings sub-page: back arrow + title + a stacked slot. */
defineProps<{ title: string }>();
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 md:p-6">
    <div class="mb-5 flex items-center gap-3">
      <RouterLink to="/settings" class="zui-back-btn" aria-label="Back to Settings">
        <ChevronLeft />
      </RouterLink>
      <h1 class="zui-title">{{ title }}</h1>
    </div>
    <div class="space-y-6">
      <slot />
    </div>
  </div>
</template>
