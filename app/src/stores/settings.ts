import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AuthUser } from '@zolltool/shared';
import { db } from '@/db/schema';
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
  const onboardingDone = ref(true);
  /** User-defined manual payment methods (e.g. TWINT, PayPal QR). */
  const customPaymentMethods = ref<string[]>([]);
  /** Prefill for new events (each event still carries its own currency). */
  const defaultCurrency = ref('CHF');

  async function init(): Promise<void> {
    deviceId.value = await ensureDeviceId();
    migratedFromV1.value = await migrateV1IfNeeded(deviceId.value);
    deviceName.value = (await getSetting<string>('deviceName')) ?? '';
    activeEventId.value = (await getSetting<string>('activeEventId')) ?? null;
    paymentProviderId.value = (await getSetting<PaymentProviderId>('paymentProviderId')) ?? 'manual';
    onActiveProviderChanged(paymentProviderId.value);
    serverUrl.value = (await api.getServerUrl()) ?? '';
    syncUser.value = (await api.getSyncUser()) ?? null;
    customPaymentMethods.value = (await getSetting<string[]>('customPaymentMethods')) ?? [];
    defaultCurrency.value = (await getSetting<string>('defaultCurrency')) ?? 'CHF';
    if (syncUser.value) void startSync();

    // First-run setup guide: only on a truly fresh install — devices that
    // already carry data (incl. migrated v1 data) skip it silently.
    if (!(await getSetting<boolean>('onboardingDone'))) {
      if ((await db.events.count()) > 0) {
        await setSetting('onboardingDone', true);
      } else {
        onboardingDone.value = false;
      }
    }
    ready.value = true;
  }

  async function addCustomPaymentMethod(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || customPaymentMethods.value.some((m) => m.toLowerCase() === trimmed.toLowerCase())) return;
    customPaymentMethods.value = [...customPaymentMethods.value, trimmed];
    await setSetting('customPaymentMethods', [...customPaymentMethods.value]);
  }

  async function removeCustomPaymentMethod(name: string): Promise<void> {
    customPaymentMethods.value = customPaymentMethods.value.filter((m) => m !== name);
    await setSetting('customPaymentMethods', [...customPaymentMethods.value]);
  }

  async function completeOnboarding(): Promise<void> {
    onboardingDone.value = true;
    await setSetting('onboardingDone', true);
  }

  /** Re-open the guide from Settings. */
  function reopenOnboarding(): void {
    onboardingDone.value = false;
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

  async function setDefaultCurrency(currency: string): Promise<void> {
    const normalized = currency.trim().toUpperCase() || 'CHF';
    defaultCurrency.value = normalized;
    await setSetting('defaultCurrency', normalized);
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
    onboardingDone,
    customPaymentMethods,
    defaultCurrency,
    init,
    setActiveEvent,
    setDeviceName,
    setDefaultCurrency,
    setPaymentProvider,
    loginToServer,
    registerOnServer,
    logoutFromServer,
    completeOnboarding,
    reopenOnboarding,
    addCustomPaymentMethod,
    removeCustomPaymentMethod,
  };
});
