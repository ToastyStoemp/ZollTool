<script setup lang="ts">
defineProps<{
  title: string;
  phase: string;
  description: string;
  legacyHref?: string;
}>();
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
    <h1 class="text-2xl font-bold text-slate-100">{{ title }}</h1>
    <p class="max-w-md text-sm text-slate-400">{{ description }}</p>
    <span class="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-emerald-400">
      Arrives in {{ phase }}
    </span>
    <a
      v-if="legacyHref"
      :href="legacyHref"
      class="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
    >
      Open in legacy app
    </a>
  </div>
</template>
