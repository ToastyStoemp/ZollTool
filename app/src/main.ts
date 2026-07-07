import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { useSettingsStore } from './stores/settings';
import './assets/main.css';

const app = createApp(App).use(createPinia()).use(router);

// Device id + one-time v1 migration must complete before any view queries data.
useSettingsStore()
  .init()
  .finally(() => app.mount('#app'));
