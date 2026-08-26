/// <reference types="vite/client" />

/** Build-time app version (date-stamped versionName from android/app/build.gradle). */
declare const __APP_VERSION__: string;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
