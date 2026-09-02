<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import jsQR from 'jsqr';

/**
 * Live camera QR scanner: opens the rear camera (getUserMedia) and runs jsQR on
 * each frame, emitting `detected` with the raw QR text the moment one is found —
 * no photo, no button. Emits `unavailable` if the camera can't start (permission
 * denied / old WebView) so the caller can fall back to the photo-capture flow.
 */
const emit = defineEmits<{ detected: [text: string]; cancel: []; unavailable: [] }>();

const video = ref<HTMLVideoElement | null>(null);
let stream: MediaStream | null = null;
let raf = 0;
let done = false;
const canvas = document.createElement('canvas');

async function start(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    emit('unavailable');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch {
    emit('unavailable');
    return;
  }
  const v = video.value;
  if (!v) return;
  v.srcObject = stream;
  try {
    await v.play();
  } catch {
    /* autoplay quirks — the loop still reads frames once ready */
  }
  raf = requestAnimationFrame(scan);
}

function scan(): void {
  if (done) return;
  const v = video.value;
  if (v && v.readyState >= 2 && v.videoWidth > 0) {
    // Downscale to keep jsQR fast on big camera frames.
    const s = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * s);
    const h = Math.round(v.videoHeight * s);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(v, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code?.data) {
        done = true;
        emit('detected', code.data);
        return;
      }
    }
  }
  raf = requestAnimationFrame(scan);
}

function stop(): void {
  done = true;
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

onMounted(start);
onBeforeUnmount(stop);
</script>

<template>
  <div class="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/90 p-4">
    <div class="relative w-full max-w-sm overflow-hidden rounded-2xl bg-black ring-1 ring-slate-700">
      <video ref="video" class="h-72 w-full object-cover" autoplay muted playsinline></video>
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div class="h-44 w-44 rounded-2xl border-2 border-emerald-400/90"></div>
      </div>
    </div>
    <p class="mt-4 max-w-sm text-center text-sm text-slate-300">Point the camera at the connect QR — it applies automatically.</p>
    <button
      type="button"
      class="mt-4 rounded-lg bg-slate-800 px-5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
      @click="emit('cancel')"
    >
      Cancel
    </button>
  </div>
</template>
