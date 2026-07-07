import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// PAGES=1 → GitHub Pages build (served at /ZollTool/); default → Capacitor/local (relative)
export default defineConfig({
  base: process.env.PAGES ? '/ZollTool/' : './',
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
