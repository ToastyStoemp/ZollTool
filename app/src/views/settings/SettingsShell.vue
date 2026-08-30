<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next';

/** Shared chrome for a Settings sub-page: back arrow + title + a stacked slot. */
defineProps<{ title: string }>();
</script>

<template>
  <div class="zui-settings-page">
    <div class="zui-settings-head">
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
