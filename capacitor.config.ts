import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.getupgames.zolltool',
  appName: 'ZollTool',
  webDir: 'app/dist',
  android: {
    buildOptions: {
      keystorePath: 'zolltool.keystore',
      keystorePassword: '',
      keystoreAlias: 'zolltool',
      keystoreAliasPassword: '',
      releaseType: 'APK',
    },
  },
  server: {
    androidScheme: 'http',
  },
  plugins: {
    MyPos: {},
    // The app UI is always dark — force light system-bar icons regardless of device theme
    SystemBars: {
      style: 'DARK',
    },
  },
};

// Dev-only live reload: CAP_SERVER_URL=http://<pc-lan-ip>:5173 npx cap sync android
if (process.env.CAP_SERVER_URL) {
  config.server = {
    ...config.server,
    url: process.env.CAP_SERVER_URL,
    cleartext: true,
  };
}

export default config;
