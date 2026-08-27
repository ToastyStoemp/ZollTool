<script setup lang="ts">
import type { ReceiptLine } from '@/lib/receipt';

/**
 * On-screen render of a thermal receipt (58mm / 32-char paper). Takes the same
 * ReceiptLine[] the printer gets (from buildReceiptLines), so what you see is
 * what prints: monospace, left/right padded rows, centered header, logo.
 */
defineProps<{ lines: ReceiptLine[] }>();
</script>

<template>
  <div class="rp-paper">
    <div class="rp-content">
      <template v-for="(l, i) in lines" :key="i">
        <img v-if="l.kind === 'image'" :src="`data:image/png;base64,${l.imageB64}`" class="rp-logo" alt="Receipt logo" />
        <div v-else-if="l.kind === 'space'" class="rp-space">&nbsp;</div>
        <div v-else class="rp-line" :class="{ 'rp-dh': l.doubleHeight }" :style="{ textAlign: l.align || 'left' }">
          <span>{{ l.text || ' ' }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.rp-paper {
  display: inline-block;
  background: #fff;
  color: #16181d;
  padding: 16px 12px 22px;
  border-radius: 5px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  max-width: 100%;
  overflow-x: auto;
}
.rp-content {
  width: 32ch;
  font-family: 'Courier New', ui-monospace, monospace;
  font-size: 11.5px;
  line-height: 1.35;
}
.rp-line {
  white-space: pre;
}
.rp-line.rp-dh {
  line-height: 2;
  font-weight: 700;
}
.rp-line.rp-dh span {
  display: inline-block;
  transform: scaleY(1.7);
  transform-origin: center;
}
.rp-space {
  height: 0.9em;
}
.rp-logo {
  display: block;
  width: 100%;
  margin: 0 auto 5px;
}
</style>
