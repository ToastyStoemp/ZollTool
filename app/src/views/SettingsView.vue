<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { getSetting, setSetting, setSyncedSetting } from '@/db/repo';
import { allProviders } from '@/payments/registry';
import { SUMUP_KEY_SETTING } from '@/payments/sumup';
import { REMOTE_CARBON_DEVICE_KEY } from '@/payments/mypos-carbon-remote';
import type { PaymentProviderId, ProviderStatus } from '@/payments/provider';
import { showToast } from '@/lib/toast';
import { exportBackupJson, exportBackupZipTo, importBackup, importBackupZip } from '@/lib/export/backup-json';
import { saveTextFile, createFileWriter } from '@/lib/download';
import { syncState, syncNow } from '@/sync/engine';
import {
  listDevices,
  listApiTokens,
  createApiToken,
  revokeApiToken,
  type ApiTokenSummary,
  type MintedApiToken,
} from '@/sync/api';
import type { DeviceSummary } from '@zolltool/shared';
import { connectQrDataUrl, decodeConnectQr } from '@/lib/qr';
import { hashPin, pinState, setPin } from '@/lib/pin';
import { MonitorSmartphone } from 'lucide-vue-next';
import { DisplayLink } from '@/native/plugins';
import { DISPLAY_KEYS } from '@/lib/display';
import {
  RECEIPT_KEYS,
  loadReceiptConfig,
  printReceipt,
  printingAvailable,
  processLogoFile,
  processLogoForScreen,
  type ArtistInfo,
  type ReceiptLine,
} from '@/lib/receipt';
import { ThermalPrinter, hasNativePlugin, isNative } from '@/native/plugins';
import {
  checkForUpdate,
  downloadUpdate,
  installDownloadedUpdate,
  updateDownload,
  type UpdateCheck,
} from '@/lib/updates';
import { sendDiagnosticLog } from '@/lib/diagnostics';
import { Camera, QrCode } from 'lucide-vue-next';
import ModalShell from '@/components/ModalShell.vue';

const settings = useSettingsStore();

// ── Editable drafts ─────────────────────────────────────────────────────────
// Inputs bind to these local refs, not to the store: the provider-status poll
// re-renders this view every few seconds, and a `:value="store.x"` binding
// would reset the DOM input to the stored value mid-typing. Drafts are synced
// from the store once it's ready and persisted on change (blur/Enter).
const deviceNameDraft = ref('');
const currencyDraft = ref('');
const roundingDraft = ref('0');

async function saveDeviceName(): Promise<void> {
  await settings.setDeviceName(deviceNameDraft.value.trim());
}

async function saveCurrency(): Promise<void> {
  await settings.setDefaultCurrency(currencyDraft.value);
  currencyDraft.value = settings.defaultCurrency; // reflect normalization (upper-case, CHF fallback)
}

async function saveRounding(): Promise<void> {
  await settings.setDefaultRoundingIncrement(Number(roundingDraft.value));
  roundingDraft.value = String(settings.defaultRoundingIncrement);
}

const statuses = ref<Record<string, ProviderStatus & { available: boolean }>>({});
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function refreshStatuses(): Promise<void> {
  for (const p of allProviders()) {
    const available = await p.isAvailable();
    const status = available ? await p.getStatus() : { connected: false, detail: 'Not available here' };
    statuses.value[p.id] = { ...status, available };
  }
}

const sumupKey = ref('');
const remoteCarbonDeviceId = ref('');
const knownCarbons = ref<DeviceSummary[]>([]);
const carbonsLoading = ref(false);
const carbonsError = ref('');

onMounted(async () => {
  refreshStatuses();
  pollTimer = setInterval(refreshStatuses, 5000);
  sumupKey.value = (await getSetting<string>(SUMUP_KEY_SETTING)) ?? '';
  remoteCarbonDeviceId.value = (await getSetting<string>(REMOTE_CARBON_DEVICE_KEY)) ?? '';
  void refreshKnownCarbons();
  if (settings.syncUser && settings.syncUser.role !== 'member') void refreshApiTokens();
});

async function saveSumupKey(): Promise<void> {
  await setSyncedSetting(SUMUP_KEY_SETTING, sumupKey.value.trim());
  showToast('SumUp affiliate key saved', 'success');
}

/** Devices that have shown up with flavor='carbon' on this account, newest-seen first. */
async function refreshKnownCarbons(): Promise<void> {
  carbonsLoading.value = true;
  carbonsError.value = '';
  try {
    knownCarbons.value = (await listDevices()).filter((d) => d.flavor === 'carbon');
  } catch (err) {
    carbonsError.value = err instanceof Error ? err.message : String(err);
  } finally {
    carbonsLoading.value = false;
  }
}

// Local per-device, not synced — different registers may pair with different
// physical Carbon terminals, same reasoning as the Bluetooth display address.
async function saveRemoteCarbonDeviceId(): Promise<void> {
  await setSetting(REMOTE_CARBON_DEVICE_KEY, remoteCarbonDeviceId.value.trim());
  showToast('Remote Carbon device ID saved', 'success');
  refreshStatuses();
}

function fmtLastSeen(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

async function selectProvider(id: PaymentProviderId): Promise<void> {
  await settings.setPaymentProvider(id);
  showToast('Payment provider updated', 'success');
  refreshStatuses();
}

async function configureProvider(id: PaymentProviderId): Promise<void> {
  const provider = allProviders().find((p) => p.id === id);
  if (!provider?.configure) return;
  try {
    await provider.configure();
    showToast('Connecting…', 'info');
  } catch (err) {
    showToast(String(err), 'error');
  }
  setTimeout(refreshStatuses, 1500);
}

// ── Custom payment methods ──────────────────────────────────────────────────
const newMethod = ref('');

async function addMethod(): Promise<void> {
  await settings.addCustomPaymentMethod(newMethod.value);
  newMethod.value = '';
}

// ── Server sync ─────────────────────────────────────────────────────────────
const authMode = ref<'login' | 'register'>('login');
const authUrl = ref(settings.serverUrl);
const authEmail = ref('');
const authPassword = ref('');
const authInvite = ref('');
const authAccountName = ref('');
const authBusy = ref(false);
const authError = ref('');

// Sync drafts from the store once it has loaded (or immediately if it already has).
watch(
  () => settings.ready,
  (ready) => {
    if (!ready) return;
    deviceNameDraft.value = settings.deviceName;
    currencyDraft.value = settings.defaultCurrency;
    roundingDraft.value = String(settings.defaultRoundingIncrement);
    if (!authUrl.value) authUrl.value = settings.serverUrl;
  },
  { immediate: true },
);

async function submitAuth(): Promise<void> {
  if (!authUrl.value.trim() || !authEmail.value.trim() || !authPassword.value) {
    authError.value = 'Server, email and password are required';
    return;
  }
  authBusy.value = true;
  authError.value = '';
  try {
    if (authMode.value === 'login') {
      await settings.loginToServer(authUrl.value, authEmail.value.trim(), authPassword.value);
    } else {
      await settings.registerOnServer(authUrl.value, {
        email: authEmail.value.trim(),
        password: authPassword.value,
        inviteCode: authInvite.value.trim() || undefined,
        accountName: authAccountName.value.trim() || undefined,
      });
    }
    authPassword.value = '';
    showToast('Connected — sync is on', 'success');
  } catch (err) {
    authError.value = err instanceof Error ? err.message : String(err);
  } finally {
    authBusy.value = false;
  }
}

async function doLogout(): Promise<void> {
  await settings.logoutFromServer();
  // On web, logging out immediately re-shows the login gate (App.vue) — it
  // does not keep working offline the way the native app does.
  showToast(isNative ? 'Logged out — the app keeps working offline' : 'Logged out', 'info');
}

// ── API access — scoped, read-only tokens for back-office tools (e.g. ZollTax) ─
// Owner/admin only; the server returns the plaintext `zt_…` exactly once at
// creation, so we surface it in-place with a copy affordance and never again.
const apiTokens = ref<ApiTokenSummary[]>([]);
const apiTokensLoading = ref(false);
const apiTokensError = ref('');
const newTokenName = ref('');
const creatingToken = ref(false);
const mintedToken = ref<MintedApiToken | null>(null);

async function refreshApiTokens(): Promise<void> {
  apiTokensLoading.value = true;
  apiTokensError.value = '';
  try {
    apiTokens.value = await listApiTokens();
  } catch (err) {
    apiTokensError.value = err instanceof Error ? err.message : String(err);
  } finally {
    apiTokensLoading.value = false;
  }
}

async function createToken(): Promise<void> {
  creatingToken.value = true;
  apiTokensError.value = '';
  try {
    mintedToken.value = await createApiToken(newTokenName.value.trim() || undefined);
    newTokenName.value = '';
    await refreshApiTokens();
  } catch (err) {
    apiTokensError.value = err instanceof Error ? err.message : String(err);
  } finally {
    creatingToken.value = false;
  }
}

async function copyMintedToken(): Promise<void> {
  if (!mintedToken.value) return;
  try {
    await navigator.clipboard.writeText(mintedToken.value.token);
    showToast('Token copied to clipboard', 'success');
  } catch {
    showToast('Could not copy — select and copy it manually', 'error');
  }
}

async function revokeToken(t: ApiTokenSummary): Promise<void> {
  if (!confirm(`Revoke "${t.name}"? Any tool using it will immediately lose access.`)) return;
  apiTokensError.value = '';
  try {
    await revokeApiToken(t.id);
    if (mintedToken.value?.id === t.id) mintedToken.value = null;
    await refreshApiTokens();
    showToast('Token revoked', 'info');
  } catch (err) {
    apiTokensError.value = err instanceof Error ? err.message : String(err);
  }
}

function fmtTokenTime(ts: number | null | undefined): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── App updates (native only) — checks the sync server, see lib/updates.ts ──
// Download progress (updateDownload) is a module-level singleton shared with
// App.vue's background auto-check, so this page reflects an in-flight
// download it didn't start itself instead of kicking off a second one.
const updateCheck = ref<UpdateCheck | null>(null);
const updateChecking = ref(false);
const updateError = ref('');

// A previously-downloaded APK is only safe to install as-is if it matches
// the build this check just reported — otherwise the server published a
// newer one since and the stale download needs replacing first.
const downloadReadyForCheck = computed(
  () => updateDownload.ready && updateCheck.value != null && updateDownload.versionName === updateCheck.value.versionName,
);
const downloadPct = computed(() =>
  updateDownload.totalBytes > 0 ? Math.min(100, Math.round((updateDownload.bytesWritten / updateDownload.totalBytes) * 100)) : null,
);

async function checkUpdate(): Promise<void> {
  updateChecking.value = true;
  updateError.value = '';
  updateCheck.value = null;
  try {
    updateCheck.value = await checkForUpdate(settings.serverUrl);
    if (!updateCheck.value) updateError.value = 'No update info available — set a server URL under Server sync first.';
  } catch (err) {
    updateError.value = err instanceof Error ? err.message : String(err);
  } finally {
    updateChecking.value = false;
  }
}

async function doDownloadOrInstall(): Promise<void> {
  if (!updateCheck.value) return;
  if (downloadReadyForCheck.value) {
    try {
      await installDownloadedUpdate();
    } catch (err) {
      showToast(`Install failed: ${err instanceof Error ? err.message : err}`, 'error');
    }
    return;
  }
  await downloadUpdate(updateCheck.value);
  if (updateDownload.error) {
    showToast(`Download failed: ${updateDownload.error}`, 'error');
  }
}

// ── Diagnostics ──────────────────────────────────────────────────────────────
const diagnosticsSending = ref(false);
const diagnosticsSent = ref(false);

async function doSendDiagnostics(): Promise<void> {
  diagnosticsSending.value = true;
  diagnosticsSent.value = false;
  try {
    await sendDiagnosticLog('manual');
    diagnosticsSent.value = true;
  } catch (err) {
    showToast(`Send failed: ${err instanceof Error ? err.message : err}`, 'error');
  } finally {
    diagnosticsSending.value = false;
  }
}

// ── Quick connect via QR ────────────────────────────────────────────────────
// Share: this device shows a QR with URL + email + password. The password is
// never stored locally (login keeps only tokens), so the user types it once
// to embed it. Scan: photo-capture + jsQR fills the login form and connects.
const showShareQr = ref(false);
const shareQrPassword = ref('');
const shareQrImg = ref('');

function openShareQr(): void {
  shareQrPassword.value = '';
  shareQrImg.value = '';
  showShareQr.value = true;
}

async function generateShareQr(): Promise<void> {
  if (!shareQrPassword.value) return;
  shareQrImg.value = await connectQrDataUrl({
    url: settings.serverUrl,
    email: settings.syncUser?.email ?? '',
    password: shareQrPassword.value,
  });
}

const scanInput = ref<HTMLInputElement | null>(null);

async function onScanFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const payload = await decodeConnectQr(file);
    if (!payload) {
      showToast('No ZollTool connect code found in the photo', 'error');
      return;
    }
    authMode.value = 'login';
    authUrl.value = payload.url;
    authEmail.value = payload.email;
    authPassword.value = payload.password;
    showToast('Code scanned — connecting…', 'info');
    await submitAuth();
  } catch (err) {
    showToast(`Scan failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

function fmtSyncTime(ts: number): string {
  return ts ? new Date(ts).toLocaleTimeString() : 'never';
}

// ── Artist & receipt info ────────────────────────────────────────────────────
// Used to prefill customs documents and, on the myPOS Carbon, printed as the
// receipt header. Saved as one block via the Save button (drafts, same reason
// as the device fields above).
const artistDraft = reactive<Required<ArtistInfo>>({
  companyName: '',
  fullName: '',
  street: '',
  postCodeCity: '',
  countryOfOrigin: '',
  phone: '',
  email: '',
  vatNumber: '',
});
const receiptLogo = ref('');
const receiptFooterDraft = ref('');
const receiptAutoPrint = ref(false);
const artistSaved = ref(false);
const logoInput = ref<HTMLInputElement | null>(null);

// Printing targets: the Carbon's built-in printer, or — on any other native
// build — a Bluetooth ESC/POS thermal printer paired in Android settings.
const isCarbon = hasNativePlugin('CarbonPayment');
const hasThermalPlugin = hasNativePlugin('ThermalPrinter') && !isCarbon;
const canPrint = ref(false);
const printerName = ref('');
const printerChoices = ref<Array<{ name: string; address: string }>>([]);
const printerBusy = ref(false);

async function refreshPrintAvailability(): Promise<void> {
  canPrint.value = await printingAvailable();
}

onMounted(async () => {
  const artist = (await getSetting<ArtistInfo>(RECEIPT_KEYS.artist)) ?? {};
  for (const key of Object.keys(artistDraft) as (keyof ArtistInfo)[]) {
    if (typeof artist[key] === 'string') artistDraft[key] = artist[key];
  }
  receiptLogo.value = (await getSetting<string>(RECEIPT_KEYS.logoB64)) ?? '';
  receiptFooterDraft.value = (await getSetting<string>(RECEIPT_KEYS.footerText)) ?? '';
  receiptAutoPrint.value = (await getSetting<boolean>(RECEIPT_KEYS.autoPrint)) ?? false;
  printerName.value = (await getSetting<string>(RECEIPT_KEYS.printerName)) ?? '';
  await refreshPrintAvailability();
});

async function findPrinters(): Promise<void> {
  try {
    const { printers } = await ThermalPrinter.listPrinters();
    printerChoices.value = printers;
    if (!printers.length) {
      showToast('No paired Bluetooth devices — pair the printer in Android Bluetooth settings first', 'info');
    }
  } catch (err) {
    showToast(String(err), 'error');
  }
}

async function selectPrinter(e: Event): Promise<void> {
  const address = (e.target as HTMLSelectElement).value;
  const choice = printerChoices.value.find((p) => p.address === address);
  if (!choice) return;
  await setSetting(RECEIPT_KEYS.printerAddress, choice.address);
  await setSetting(RECEIPT_KEYS.printerName, choice.name);
  printerName.value = choice.name;
  printerChoices.value = [];
  await refreshPrintAvailability();
  showToast(`Printer set: ${choice.name}`, 'success');
}

async function forgetPrinter(): Promise<void> {
  await setSetting(RECEIPT_KEYS.printerAddress, undefined);
  await setSetting(RECEIPT_KEYS.printerName, undefined);
  printerName.value = '';
  await refreshPrintAvailability();
}

async function testPrint(): Promise<void> {
  printerBusy.value = true;
  try {
    const config = await loadReceiptConfig();
    const lines: ReceiptLine[] = [];
    if (config.logoB64) lines.push({ kind: 'image', imageB64: config.logoB64 });
    if (config.artist.companyName) {
      lines.push({ kind: 'text', text: config.artist.companyName, align: 'center', doubleHeight: true });
    }
    lines.push({ kind: 'text', text: 'Printer test', align: 'center' });
    lines.push({ kind: 'text', text: '-'.repeat(32) });
    lines.push({ kind: 'text', text: new Date().toLocaleString() });
    lines.push({ kind: 'space' });
    const result = await printReceipt(lines);
    showToast(result.printed ? 'Test receipt printed' : `Print failed: ${result.error}`, result.printed ? 'success' : 'error');
  } catch (err) {
    showToast(`Print failed: ${err instanceof Error ? err.message : err}`, 'error');
  } finally {
    printerBusy.value = false;
  }
}

async function saveArtistInfo(): Promise<void> {
  await setSyncedSetting(RECEIPT_KEYS.artist, { ...artistDraft });
  await setSyncedSetting(RECEIPT_KEYS.footerText, receiptFooterDraft.value);
  artistSaved.value = true;
  setTimeout(() => (artistSaved.value = false), 2000);
}

async function onLogoFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    receiptLogo.value = await processLogoFile(file);
    await setSyncedSetting(RECEIPT_KEYS.logoB64, receiptLogo.value);
    await setSyncedSetting(RECEIPT_KEYS.logoScreenB64, await processLogoForScreen(file));
  } catch (err) {
    showToast(`Logo failed: ${err}`, 'error');
  }
}

async function removeLogo(): Promise<void> {
  receiptLogo.value = '';
  await setSyncedSetting(RECEIPT_KEYS.logoB64, '');
  await setSyncedSetting(RECEIPT_KEYS.logoScreenB64, '');
}

async function toggleAutoPrint(): Promise<void> {
  receiptAutoPrint.value = !receiptAutoPrint.value;
  await setSetting(RECEIPT_KEYS.autoPrint, receiptAutoPrint.value);
}

// ── Bluetooth customer display (register side) ──────────────────────────────
// Pick the paired device that runs "Customer display mode"; the POS then
// streams the cart to it directly over Bluetooth — no internet needed.
const hasDisplayLink = hasNativePlugin('DisplayLink');
const btDisplayName = ref('');
const btDisplayChoices = ref<Array<{ name: string; address: string }>>([]);

onMounted(async () => {
  btDisplayName.value = (await getSetting<string>(DISPLAY_KEYS.btName)) ?? '';
});

async function findBtDisplays(): Promise<void> {
  try {
    const { printers } = await ThermalPrinter.listPrinters(); // bonded devices, any kind
    btDisplayChoices.value = printers;
    if (!printers.length) {
      showToast('No paired devices — pair the display device in Android Bluetooth settings first', 'info');
    }
  } catch (err) {
    showToast(String(err), 'error');
  }
}

async function selectBtDisplay(e: Event): Promise<void> {
  const address = (e.target as HTMLSelectElement).value;
  const choice = btDisplayChoices.value.find((p) => p.address === address);
  if (!choice) return;
  await setSetting(DISPLAY_KEYS.btAddress, choice.address);
  await setSetting(DISPLAY_KEYS.btName, choice.name);
  await DisplayLink.configure({ address: choice.address }).catch(() => {});
  btDisplayName.value = choice.name;
  btDisplayChoices.value = [];
  showToast(`Customer display: ${choice.name}`, 'success');
}

async function forgetBtDisplay(): Promise<void> {
  await setSetting(DISPLAY_KEYS.btAddress, undefined);
  await setSetting(DISPLAY_KEYS.btName, undefined);
  await DisplayLink.disconnect().catch(() => {});
  btDisplayName.value = '';
}

// ── Security: PIN lock for the management views ─────────────────────────────
const pinCurrent = ref('');
const pinNew = ref('');
const pinConfirm = ref('');
const hasPin = computed(() => !!pinState.hash);

async function verifyCurrentPin(): Promise<boolean> {
  if (!hasPin.value) return true;
  if ((await hashPin(pinCurrent.value)) === pinState.hash) return true;
  showToast('Current PIN is wrong.', 'error');
  return false;
}

async function savePinSettings(): Promise<void> {
  if (!/^\d{4,8}$/.test(pinNew.value)) {
    showToast('PIN must be 4–8 digits.', 'error');
    return;
  }
  if (pinNew.value !== pinConfirm.value) {
    showToast('PINs do not match.', 'error');
    return;
  }
  if (!(await verifyCurrentPin())) return;
  await setPin(pinNew.value);
  pinCurrent.value = pinNew.value = pinConfirm.value = '';
  showToast('PIN set — Settings, Catalog, History, Customs and Admin now require it', 'success');
}

async function removePinSettings(): Promise<void> {
  if (!(await verifyCurrentPin())) return;
  await setPin(null);
  pinCurrent.value = pinNew.value = pinConfirm.value = '';
  showToast('PIN removed', 'info');
}

// ── Backup ──────────────────────────────────────────────────────────────────
const importInput = ref<HTMLInputElement | null>(null);
const busyBackup = ref(false);

function backupStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

async function doExportJson(): Promise<void> {
  busyBackup.value = true;
  try {
    const json = await exportBackupJson();
    await saveTextFile(`zolltool_backup_${backupStamp()}.json`, json, 'application/json');
  } catch (err) {
    showToast(`Backup failed: ${err}`, 'error');
  } finally {
    busyBackup.value = false;
  }
}

async function doExportZip(): Promise<void> {
  busyBackup.value = true;
  try {
    // Streamed: photos pass through one at a time, so big backups can't OOM
    // the WebView (the old all-in-memory export crashed Android 7 tablets).
    const writer = await createFileWriter(`zolltool_backup_${backupStamp()}.zip`, 'application/zip');
    if (!writer) return; // user cancelled the save dialog
    try {
      await exportBackupZipTo(writer);
      await writer.close();
    } catch (err) {
      await writer.abort();
      throw err;
    }
  } catch (err) {
    showToast(`Backup failed: ${err}`, 'error');
  } finally {
    busyBackup.value = false;
  }
}

async function onImportFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  busyBackup.value = true;
  try {
    const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
    const counts = isZip
      ? await importBackupZip(new Uint8Array(await file.arrayBuffer()))
      : await importBackup(await file.text());
    showToast(
      `Imported ${counts.events} events, ${counts.products} products, ${counts.transactions} sales`,
      'success',
    );
  } catch (err) {
    showToast(`Import failed: ${err instanceof Error ? err.message : err}`, 'error');
  } finally {
    busyBackup.value = false;
  }
}
</script>

<template>
  <!-- Wide screens (tablet landscape, desktop): two-column masonry via CSS columns -->
  <div class="mx-auto max-w-2xl p-4 md:p-6 xl:max-w-5xl">
    <h1 class="mb-6 text-xl font-bold">Settings</h1>
    <div class="space-y-6 xl:columns-2 xl:gap-6 xl:space-y-0">

    <!-- Device -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800 xl:mb-6 xl:break-inside-avoid">
      <h2 class="mb-3 text-sm font-semibold text-slate-300">This device</h2>
      <label class="block text-sm">
        <span class="text-slate-400">Device name</span>
        <input
          v-model="deviceNameDraft"
          placeholder="e.g. Wolf's tablet"
          class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
          @change="saveDeviceName"
        />
      </label>
      <label class="mt-3 block text-sm">
        <span class="text-slate-400">Default currency (prefilled for new events)</span>
        <input
          v-model="currencyDraft"
          placeholder="CHF"
          class="mt-1 w-24 rounded-lg bg-slate-800 px-3 py-2 uppercase"
          @change="saveCurrency"
        />
      </label>
      <label class="mt-3 block text-sm">
        <span class="text-slate-400">Default rounding increment (prefilled for new events)</span>
        <select
          v-model="roundingDraft"
          class="mt-1 w-24 rounded-lg bg-slate-800 px-3 py-2"
          @change="saveRounding"
        >
          <option value="0">Off</option>
          <option value="1">1</option>
          <option value="5">5</option>
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </label>
      <p class="mt-2 text-xs text-slate-500">Device ID: {{ settings.deviceId }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
          @click="settings.reopenOnboarding()"
        >
          Run setup guide
        </button>
        <RouterLink
          v-if="settings.syncUser || hasDisplayLink"
          to="/display"
          class="flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
        >
          <MonitorSmartphone class="h-4 w-4" /> Customer display mode
        </RouterLink>
      </div>

      <!-- Bluetooth customer display (register side) -->
      <div v-if="hasDisplayLink" class="mt-3 rounded-lg bg-slate-800/50 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="min-w-0">
            <span class="text-sm text-slate-300">Customer display (Bluetooth)</span>
            <p class="text-xs text-slate-500">
              {{ btDisplayName || 'None — pair the display device in Android Bluetooth settings, then select it here. It must be in "Customer display mode".' }}
            </p>
          </div>
          <div class="ml-auto flex gap-2">
            <button
              class="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600"
              @click="findBtDisplays"
            >
              {{ btDisplayName ? 'Change' : 'Select device' }}
            </button>
            <button
              v-if="btDisplayName"
              class="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
              @click="forgetBtDisplay"
            >
              Forget
            </button>
          </div>
        </div>
        <select
          v-if="btDisplayChoices.length"
          class="mt-2 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          @change="selectBtDisplay"
        >
          <option value="">— pick a paired device —</option>
          <option v-for="p in btDisplayChoices" :key="p.address" :value="p.address">
            {{ p.name }} ({{ p.address }})
          </option>
        </select>
      </div>
    </section>

    <!-- Payment provider -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800 xl:mb-6 xl:break-inside-avoid">
      <h2 class="mb-3 text-sm font-semibold text-slate-300">Card payment terminal</h2>
      <div class="space-y-2">
        <div
          v-for="p in allProviders()"
          :key="p.id"
          class="flex items-center gap-3 rounded-lg p-3 ring-1"
          :class="
            settings.paymentProviderId === p.id
              ? 'bg-emerald-950/40 ring-emerald-700'
              : 'bg-slate-800/50 ring-slate-700'
          "
        >
          <input
            type="radio"
            name="provider"
            :checked="settings.paymentProviderId === p.id"
            :disabled="!statuses[p.id]?.available"
            @change="selectProvider(p.id)"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium" :class="{ 'opacity-40': !statuses[p.id]?.available }">
              {{ p.label }}
            </p>
            <p class="text-xs text-slate-500">{{ statuses[p.id]?.detail || '…' }}</p>
          </div>
          <span
            class="h-2.5 w-2.5 shrink-0 rounded-full"
            :class="statuses[p.id]?.connected ? 'bg-emerald-400' : 'bg-slate-600'"
          />
          <button
            v-if="p.configure && statuses[p.id]?.available"
            class="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600"
            @click="configureProvider(p.id)"
          >
            Connect
          </button>
        </div>
      </div>
      <label v-if="statuses['sumup']?.available" class="mt-3 block text-sm">
        <span class="text-slate-400">SumUp affiliate key</span>
        <input
          v-model="sumupKey"
          type="text"
          placeholder="From the SumUp developer dashboard"
          class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 font-mono text-xs"
          @change="saveSumupKey"
        />
      </label>
      <div v-if="settings.paymentProviderId === 'mypos-carbon-remote'" class="mt-3">
        <div class="mb-1 flex items-center justify-between">
          <span class="text-sm text-slate-400">Remote Carbon terminal</span>
          <button
            class="text-[11px] text-slate-500 hover:text-slate-300 disabled:opacity-40"
            :disabled="carbonsLoading"
            @click="refreshKnownCarbons"
          >
            {{ carbonsLoading ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>
        <select
          v-if="knownCarbons.length"
          v-model="remoteCarbonDeviceId"
          class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          @change="saveRemoteCarbonDeviceId"
        >
          <option value="" disabled>Choose a Carbon…</option>
          <option v-for="d in knownCarbons" :key="d.id" :value="d.id">
            {{ d.name || d.id }} — seen {{ fmtLastSeen(d.lastSeenAt) }}
          </option>
        </select>
        <p v-else-if="carbonsError" class="text-xs text-red-400">{{ carbonsError }}</p>
        <p v-else class="text-xs text-slate-500">
          No Carbon terminals seen on this account yet — open the app on it at least once, or
          paste its Device ID manually below.
        </p>
        <label class="mt-2 block text-xs">
          <span class="text-slate-500">{{ knownCarbons.length ? 'Or paste a Device ID manually' : 'Device ID' }}</span>
          <input
            v-model="remoteCarbonDeviceId"
            type="text"
            placeholder="Find this in Settings on the Carbon itself"
            class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 font-mono text-xs"
            @change="saveRemoteCarbonDeviceId"
          />
        </label>
      </div>
    </section>

    <!-- Custom payment methods -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800 xl:mb-6 xl:break-inside-avoid">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Extra payment methods</h2>
      <p class="mb-3 text-xs text-slate-500">
        Extra buttons on the sell screen for payments handled outside the app, e.g. TWINT or a
        PayPal QR code. Sales made with them count as non-cash in the history.
      </p>
      <ul v-if="settings.customPaymentMethods.length" class="mb-3 space-y-2">
        <li
          v-for="m in settings.customPaymentMethods"
          :key="m"
          class="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2 text-sm ring-1 ring-slate-700"
        >
          <span class="truncate">{{ m }}</span>
          <button
            class="rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-red-950"
            @click="settings.removeCustomPaymentMethod(m)"
          >
            Remove
          </button>
        </li>
      </ul>
      <form class="flex gap-2" @submit.prevent="addMethod">
        <input
          v-model="newMethod"
          type="text"
          placeholder="e.g. TWINT"
          class="min-w-0 flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
          :disabled="!newMethod.trim()"
        >
          Add
        </button>
      </form>
    </section>

    <!-- Artist & receipt -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800 xl:mb-6 xl:break-inside-avoid">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Artist info &amp; receipts</h2>
      <p class="mb-3 text-xs text-slate-500">
        Prefills customs documents<template v-if="canPrint"> and is printed as the header on
        receipts</template>.
      </p>
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-sm">
          <span class="text-slate-400">Company / artist name</span>
          <input v-model="artistDraft.companyName" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Full name</span>
          <input v-model="artistDraft.fullName" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Street</span>
          <input v-model="artistDraft.street" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Postcode + city</span>
          <input v-model="artistDraft.postCodeCity" placeholder="9000 Gent" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Country</span>
          <input v-model="artistDraft.countryOfOrigin" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">VAT / UID number</span>
          <input v-model="artistDraft.vatNumber" placeholder="CHE-123.456.789 MWST" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Phone</span>
          <input v-model="artistDraft.phone" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Email</span>
          <input v-model="artistDraft.email" type="email" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
      </div>

      <label class="mt-3 block text-sm">
        <span class="text-slate-400">Receipt footer (e.g. thank-you note, return policy)</span>
        <textarea
          v-model="receiptFooterDraft"
          rows="2"
          class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
          placeholder="Thank you for your purchase!"
        ></textarea>
      </label>

      <!-- Receipt logo -->
      <div class="mt-3 flex items-center gap-3">
        <div>
          <span class="text-sm text-slate-400">Receipt logo</span>
          <p class="text-xs text-slate-500">Printed on top; scaled to the 384px paper width.</p>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <img
            v-if="receiptLogo"
            :src="`data:image/png;base64,${receiptLogo}`"
            alt="Receipt logo"
            class="h-10 max-w-32 rounded bg-white object-contain p-0.5"
          />
          <button
            class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700"
            @click="logoInput?.click()"
          >
            {{ receiptLogo ? 'Replace' : 'Choose…' }}
          </button>
          <button
            v-if="receiptLogo"
            class="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
            @click="removeLogo"
          >
            Remove
          </button>
          <input ref="logoInput" type="file" accept="image/*" class="hidden" @change="onLogoFile" />
        </div>
      </div>

      <!-- Thermal printer (non-Carbon devices; the Carbon uses its built-in printer) -->
      <div v-if="hasThermalPlugin" class="mt-3 rounded-lg bg-slate-800/50 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="min-w-0">
            <span class="text-sm text-slate-300">Receipt printer (Bluetooth)</span>
            <p class="text-xs text-slate-500">
              {{ printerName || 'None — pair a thermal printer in Android Bluetooth settings, then select it here.' }}
            </p>
          </div>
          <div class="ml-auto flex gap-2">
            <button
              class="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-600"
              @click="findPrinters"
            >
              {{ printerName ? 'Change' : 'Select printer' }}
            </button>
            <button
              v-if="printerName"
              class="rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
              @click="forgetPrinter"
            >
              Forget
            </button>
          </div>
        </div>
        <select
          v-if="printerChoices.length"
          class="mt-2 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          @change="selectPrinter"
        >
          <option value="">— pick a paired device —</option>
          <option v-for="p in printerChoices" :key="p.address" :value="p.address">
            {{ p.name }} ({{ p.address }})
          </option>
        </select>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-3">
        <!-- Receipts print on request (History's print button) by default; auto-print is opt-in. -->
        <label v-if="canPrint" class="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" :checked="receiptAutoPrint" @change="toggleAutoPrint" />
          Print a receipt after every sale
        </label>
        <div class="ml-auto flex gap-2">
          <button
            v-if="canPrint"
            class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
            :disabled="printerBusy"
            @click="testPrint"
          >
            {{ printerBusy ? 'Printing…' : 'Test print' }}
          </button>
          <button
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            @click="saveArtistInfo"
          >
            {{ artistSaved ? 'Saved ✓' : 'Save' }}
          </button>
        </div>
      </div>
    </section>

    <!-- Backup -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800 xl:mb-6 xl:break-inside-avoid">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Backup</h2>
      <p class="mb-3 text-xs text-slate-500">
        Export your data as a <strong>JSON</strong> file (events, products, sales, discounts — small
        and quick, no photos), or as a full <strong>ZIP</strong> that also bundles every product
        photo. Import accepts either, plus JSON saved by the old ZollTool. Importing merges by id — it
        never deletes existing data.
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
          :disabled="busyBackup"
          @click="doExportJson"
        >
          Export JSON
        </button>
        <button
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
          :disabled="busyBackup"
          @click="doExportZip"
        >
          Export ZIP (with photos)
        </button>
        <button
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
          :disabled="busyBackup"
          @click="importInput?.click()"
        >
          Import backup
        </button>
        <input
          ref="importInput"
          type="file"
          accept="application/json,.json,application/zip,.zip"
          class="hidden"
          @change="onImportFile"
        />
      </div>
    </section>

    <!-- Server sync -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800 xl:mb-6 xl:break-inside-avoid">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Server sync</h2>

      <!-- Logged in -->
      <template v-if="settings.syncUser">
        <div class="mb-3 flex items-center gap-2">
          <span
            class="h-2.5 w-2.5 shrink-0 rounded-full"
            :class="syncState.online ? (syncState.wsConnected ? 'bg-emerald-400' : 'bg-amber-400') : 'bg-red-400'"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ settings.syncUser.email }}</p>
            <p class="truncate text-xs text-slate-500">
              {{ settings.syncUser.accountName }} · {{ settings.serverUrl }}
            </p>
          </div>
        </div>
        <p class="mb-3 text-xs text-slate-500">
          <template v-if="syncState.syncing">Syncing…</template>
          <template v-else-if="syncState.lastError">
            <span class="text-amber-400">Offline mode — {{ syncState.lastError }}</span>
          </template>
          <template v-else>
            Last sync {{ fmtSyncTime(syncState.lastSyncAt) }}
            <span v-if="syncState.pendingOps"> · {{ syncState.pendingOps }} change(s) waiting</span>
            <span v-else> · everything is up to date</span>
          </template>
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
            :disabled="syncState.syncing"
            @click="syncNow"
          >
            Sync now
          </button>
          <button
            class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
            @click="openShareQr"
          >
            <span class="flex items-center gap-1.5"><QrCode class="h-4 w-4" /> Share login (QR)</span>
          </button>
          <RouterLink
            v-if="settings.syncUser.role === 'owner'"
            to="/admin"
            class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
          >
            Server admin
          </RouterLink>
          <button class="rounded-lg px-4 py-2 text-sm text-red-400 hover:bg-red-950" @click="doLogout">
            Log out
          </button>
        </div>
      </template>

      <!-- Logged out, web: the login gate (App.vue) takes over as soon as this renders — nothing to show here. -->
      <p v-else-if="!isNative" class="text-xs text-slate-500">Logging you out…</p>

      <!-- Logged out, native app: sync is optional, log in/register right here. -->
      <template v-else>
        <p class="mb-3 text-xs text-slate-500">
          Optional: connect to a ZollTool server so several devices can sell into the same event.
          The app keeps working fully offline — changes sync whenever there's a connection.
        </p>
        <div class="mb-3 flex rounded-lg bg-slate-800 p-1 text-sm">
          <button
            class="flex-1 rounded-md px-3 py-1.5"
            :class="authMode === 'login' ? 'bg-slate-700 font-semibold' : 'text-slate-400'"
            @click="authMode = 'login'"
          >
            Log in
          </button>
          <button
            class="flex-1 rounded-md px-3 py-1.5"
            :class="authMode === 'register' ? 'bg-slate-700 font-semibold' : 'text-slate-400'"
            @click="authMode = 'register'"
          >
            Create account
          </button>
        </div>
        <form class="space-y-2" @submit.prevent="submitAuth">
          <input
            v-model="authUrl"
            type="url"
            placeholder="Server URL, e.g. https://sync.example.com"
            class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          />
          <input
            v-model="authEmail"
            type="email"
            autocomplete="email"
            placeholder="Email"
            class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          />
          <input
            v-model="authPassword"
            type="password"
            :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'"
            placeholder="Password"
            class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
          />
          <template v-if="authMode === 'register'">
            <input
              v-model="authInvite"
              type="text"
              placeholder="Invite code (joins an existing account)"
              class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
            />
            <input
              v-if="!authInvite"
              v-model="authAccountName"
              type="text"
              placeholder="Account name, e.g. GET UP GAMES"
              class="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
            />
          </template>
          <p v-if="authError" class="text-xs text-red-400">{{ authError }}</p>
          <button
            type="submit"
            class="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            :disabled="authBusy"
          >
            {{ authBusy ? 'Connecting…' : authMode === 'login' ? 'Log in' : 'Create account' }}
          </button>
          <button
            type="button"
            class="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
            :disabled="authBusy"
            @click="scanInput?.click()"
          >
            <span class="flex items-center justify-center gap-1.5"><Camera class="h-4 w-4" /> Scan connect QR from another device</span>
          </button>
          <input ref="scanInput" type="file" accept="image/*" capture="environment" class="hidden" @change="onScanFile" />
        </form>
      </template>
    </section>

    <!-- API access — scoped read-only tokens (owner/admin only) -->
    <section
      v-if="settings.syncUser && settings.syncUser.role !== 'member'"
      class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800 xl:mb-6 xl:break-inside-avoid"
    >
      <h2 class="mb-2 text-sm font-semibold text-slate-300">API access</h2>
      <p class="mb-3 text-xs text-slate-500">
        Read-only tokens let back-office tools (e.g. ZollTax) pull this account's events and
        transactions without an account password. Each token is scoped to <code>data:read</code>
        and can be revoked any time.
      </p>

      <!-- Create -->
      <div class="mb-3 flex flex-wrap gap-2">
        <input
          v-model="newTokenName"
          type="text"
          placeholder="Token name, e.g. ZollTax"
          class="min-w-0 flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm"
          @keydown.enter.prevent="createToken"
        />
        <button
          class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          :disabled="creatingToken"
          @click="createToken"
        >
          {{ creatingToken ? 'Creating…' : 'Create token' }}
        </button>
      </div>

      <!-- Freshly minted secret — shown exactly once -->
      <div v-if="mintedToken" class="mb-3 rounded-lg bg-emerald-950 p-3 ring-1 ring-emerald-800">
        <p class="mb-1 text-xs font-medium text-emerald-300">
          Copy this token now — it won't be shown again.
        </p>
        <div class="flex items-center gap-2">
          <code class="min-w-0 flex-1 break-all rounded bg-slate-950 px-2 py-1.5 font-mono text-xs text-emerald-200">{{
            mintedToken.token
          }}</code>
          <button
            class="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700"
            @click="copyMintedToken"
          >
            Copy
          </button>
          <button
            class="shrink-0 rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-slate-200"
            title="Dismiss"
            @click="mintedToken = null"
          >
            Done
          </button>
        </div>
      </div>

      <p v-if="apiTokensError" class="mb-2 text-xs text-red-400">{{ apiTokensError }}</p>

      <!-- Existing tokens -->
      <p v-if="apiTokensLoading" class="text-xs text-slate-500">Loading…</p>
      <p v-else-if="!apiTokens.length" class="text-xs text-slate-500">No tokens yet.</p>
      <ul v-else class="divide-y divide-slate-800 overflow-hidden rounded-lg ring-1 ring-slate-800">
        <li
          v-for="t in apiTokens"
          :key="t.id"
          class="flex items-center gap-3 bg-slate-900 px-3 py-2"
          :class="t.revokedAt ? 'opacity-50' : ''"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">
              {{ t.name }}
              <span
                v-if="t.revokedAt"
                class="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal text-slate-400"
                >revoked</span
              >
            </p>
            <p class="truncate text-xs text-slate-500">
              {{ t.scopes }} · created {{ fmtTokenTime(t.createdAt) }} · last used
              {{ fmtTokenTime(t.lastUsedAt) }}
            </p>
          </div>
          <button
            v-if="!t.revokedAt"
            class="shrink-0 rounded-lg px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
            @click="revokeToken(t)"
          >
            Revoke
          </button>
        </li>
      </ul>
    </section>

    <!-- App updates (native only) -->
    <section v-if="isNative" class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800 xl:mb-6 xl:break-inside-avoid">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">App updates</h2>
      <p class="mb-3 text-xs text-slate-500">
        Checks the sync server for a newer build than this device is running. Needs a server URL
        set under Server sync above.
      </p>
      <button
        class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
        :disabled="updateChecking"
        @click="checkUpdate"
      >
        {{ updateChecking ? 'Checking…' : 'Check for updates' }}
      </button>
      <p v-if="updateError" class="mt-2 text-xs text-red-400">{{ updateError }}</p>
      <div v-if="updateCheck" class="mt-3 text-sm">
        <p class="text-slate-500">Installed: {{ updateCheck.currentVersionName }}</p>
        <template v-if="updateCheck.available">
          <p class="mt-1 font-medium text-emerald-400">Update available: {{ updateCheck.versionName }}</p>
          <div v-if="updateDownload.active" class="mt-2">
            <div class="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                class="h-full rounded-full bg-emerald-600 transition-all"
                :style="{ width: (downloadPct ?? 0) + '%' }"
              />
            </div>
            <p class="mt-1 text-xs text-slate-500">
              {{ downloadPct != null ? `${downloadPct}%` : `${(updateDownload.bytesWritten / 1e6).toFixed(1)} MB` }}
            </p>
          </div>
          <button
            v-else
            class="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
            @click="doDownloadOrInstall"
          >
            {{ downloadReadyForCheck ? 'Install update' : 'Download update' }}
          </button>
        </template>
        <p v-else class="mt-1 text-slate-400">Up to date.</p>
      </div>
    </section>

    <!-- Diagnostics -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800 xl:mb-6 xl:break-inside-avoid">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Diagnostics</h2>
      <p class="mb-3 text-xs text-slate-500">
        Sends recent console warnings/errors from this device to the sync server, where the server
        owner can download them from Admin. Needs a server URL set under Server sync above.
      </p>
      <button
        class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
        :disabled="diagnosticsSending"
        @click="doSendDiagnostics"
      >
        {{ diagnosticsSending ? 'Sending…' : 'Send diagnostic log' }}
      </button>
      <p v-if="diagnosticsSent" class="mt-2 text-xs text-emerald-400">Sent.</p>
    </section>

    <!-- Security -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800 xl:mb-6 xl:break-inside-avoid">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Security</h2>
      <p class="mb-3 text-xs text-slate-500">
        Optional PIN for Settings, Catalog, History, Customs and Admin — helpers can still sell in
        the POS. Locks again when the app restarts.
        <span v-if="hasPin" class="text-emerald-400">PIN is active.</span>
      </p>
      <div class="grid grid-cols-2 gap-3">
        <label v-if="hasPin" class="col-span-2 block text-sm">
          <span class="text-slate-400">Current PIN</span>
          <input v-model="pinCurrent" type="password" inputmode="numeric" autocomplete="off" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">{{ hasPin ? 'New PIN' : 'PIN (4–8 digits)' }}</span>
          <input v-model="pinNew" type="password" inputmode="numeric" autocomplete="off" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-400">Repeat PIN</span>
          <input v-model="pinConfirm" type="password" inputmode="numeric" autocomplete="off" class="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2" />
        </label>
      </div>
      <div class="mt-3 flex gap-2">
        <button
          class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          @click="savePinSettings"
        >
          {{ hasPin ? 'Change PIN' : 'Set PIN' }}
        </button>
        <button
          v-if="hasPin"
          class="rounded-lg px-4 py-2 text-sm text-red-400 hover:bg-red-950"
          @click="removePinSettings"
        >
          Remove PIN
        </button>
      </div>
    </section>

    <!-- Legacy -->
    <section class="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800 xl:mb-6 xl:break-inside-avoid">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">Legacy app</h2>
      <p class="mb-3 text-xs text-slate-500">
        The previous version (incl. the customs tool) ships alongside until every feature is ported.
        <span v-if="settings.migratedFromV1">Your old data was imported automatically.</span>
      </p>
      <a
        href="legacy/index.html"
        class="inline-block rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
      >
        Open legacy ZollTool
      </a>
    </section>
    </div>

    <!-- Quick-connect QR modal -->
    <ModalShell v-if="showShareQr" title="Share login via QR" @close="showShareQr = false">
      <div class="space-y-3">
        <p class="text-xs text-slate-500">
          Another device can scan this code from its Settings → Server sync form to connect
          instantly. Your password isn't stored on this device, so enter it once to embed it.
          <span class="text-amber-400">The code contains the password in plain text — only show it
          to devices you trust.</span>
        </p>
        <p class="text-sm text-slate-300">
          {{ settings.serverUrl }}<br />
          {{ settings.syncUser?.email }}
        </p>
        <form class="flex gap-2" @submit.prevent="generateShareQr">
          <input
            v-model="shareQrPassword"
            type="password"
            autocomplete="current-password"
            placeholder="Account password"
            class="min-w-0 flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            class="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            :disabled="!shareQrPassword"
          >
            Generate
          </button>
        </form>
        <div v-if="shareQrImg" class="flex justify-center rounded-xl bg-white p-3">
          <img :src="shareQrImg" alt="Connect QR code" class="h-64 w-64 [image-rendering:pixelated]" />
        </div>
      </div>
    </ModalShell>
  </div>
</template>
