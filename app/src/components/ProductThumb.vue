<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { imageUrl } from '@/lib/images';
import { typeColor } from '@/lib/search';

const props = defineProps<{
  imageId?: string;
  type?: string;
  size?: 'sm' | 'lg';
}>();

const url = ref<string | null>(null);

watchEffect(async () => {
  url.value = await imageUrl(props.imageId, props.size === 'lg' ? 'full' : 'thumb');
});
</script>

<template>
  <div
    class="shrink-0 overflow-hidden rounded-lg bg-slate-800"
    :class="size === 'lg' ? 'h-32 w-32' : 'h-10 w-10'"
  >
    <img v-if="url" :src="url" class="h-full w-full object-cover" />
    <div
      v-else
      class="flex h-full w-full items-center justify-center text-xs font-bold text-slate-950/60"
      :style="{ background: typeColor(type) + '33' }"
    >
      <span :class="size === 'lg' ? 'text-3xl' : ''">🖼️</span>
    </div>
  </div>
</template>
