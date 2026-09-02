import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { useSettingsStore } from './stores/settings';
import { installDiagnostics } from './lib/diagnostics';
// main.css imports the shared ZollDesign framework (zoll-ui.css) into Tailwind's
// `components` layer, so plain Tailwind utilities can still override .zui-* rules.
import './assets/main.css';

installDiagnostics();

const app = createApp(App).use(createPinia()).use(router);

// Device id + one-time v1 migration must complete before any view queries data.
useSettingsStore()
  .init()
  .finally(() => app.mount('#app'));
