import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// The date-stamped build name lives in the Android gradle file (bump:version
// writes it). Read it at build time so the web build reports the same version
// the native app does — shown in the corner of Settings.
function androidVersionName(): string {
  try {
    const gradle = readFileSync(fileURLToPath(new URL('./../android/app/build.gradle', import.meta.url)), 'utf8');
    return gradle.match(/versionName\s+"([^"]+)"/)?.[1] ?? 'dev';
  } catch {
    return 'dev';
  }
}

// PAGES=1 → GitHub Pages build (served at /ZollTool/); default → Capacitor/local (relative)
export default defineConfig({
  base: process.env.PAGES ? '/ZollTool/' : './',
  define: {
    __APP_VERSION__: JSON.stringify(androidVersionName()),
  },
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // MyPOS Carbon ships an old WebView — keep the JS target conservative.
    target: 'es2018',
  },
  server: {
    host: true,
  },
});
