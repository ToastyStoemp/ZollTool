import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AuthUser } from '@zolltool/shared';
import { ensureDeviceId, getSetting, setSetting } from '@/db/repo';
import { migrateV1IfNeeded } from '@/db/migrate-v1';
import type { PaymentProviderId } from '@/payments/provider';
import { onActiveProviderChanged } from '@/payments/registry';
import * as api from '@/sync/api';
import { startSync, stopSync } from '@/sync/engine';

export const useSettingsStore = defineStore('settings', () => {
  const ready = ref(false);
  const deviceId = ref('');
  const deviceName = ref('');
  const activeEventId = ref<string | null>(null);
  const paymentProviderId = ref<PaymentProviderId>('manual');
  const migratedFromV1 = ref(false);
  const serverUrl = ref('');
  const syncUser = ref<AuthUser | null>(null);

  async function init(): Promise<void> {
    deviceId.value = await ensureDeviceId();
    migratedFromV1.value = await migrateV1IfNeeded(deviceId.value);
    deviceName.value = (await getSetting<string>('deviceName')) ?? '';
    activeEventId.value = (await getSetting<string>('activeEventId')) ?? null;
    paymentProviderId.value = (await getSetting<PaymentProviderId>('paymentProviderId')) ?? 'manual';
    onActiveProviderChanged(paymentProviderId.value);
    serverUrl.value = (await api.getServerUrl()) ?? '';
    syncUser.value = (await api.getSyncUser()) ?? null;
    if (syncUser.value) void startSync();
    ready.value = true;
  }

  async function loginToServer(url: string, email: string, password: string): Promise<void> {
    syncUser.value = await api.login(url, email, password);
    serverUrl.value = url;
    await startSync();
  }

  async function registerOnServer(
    url: string,
    req: { email: string; password: string; inviteCode?: string; accountName?: string },
  ): Promise<void> {
    syncUser.value = await api.registerAccount(url, req);
    serverUrl.value = url;
    await startSync();
  }

  async function logoutFromServer(): Promise<void> {
    stopSync();
    await api.logout();
    syncUser.value = null;
  }

  async function setActiveEvent(id: string | null): Promise<void> {
    activeEventId.value = id;
    await setSetting('activeEventId', id);
  }

  async function setDeviceName(name: string): Promise<void> {
    deviceName.value = name;
    await setSetting('deviceName', name);
  }

  async function setPaymentProvider(id: PaymentProviderId): Promise<void> {
    paymentProviderId.value = id;
    await setSetting('paymentProviderId', id);
    onActiveProviderChanged(id);
  }

  return {
    ready,
    deviceId,
    deviceName,
    activeEventId,
    paymentProviderId,
    migratedFromV1,
    serverUrl,
    syncUser,
    init,
    setActiveEvent,
    setDeviceName,
    setPaymentProvider,
    loginToServer,
    registerOnServer,
    logoutFromServer,
  };
});
