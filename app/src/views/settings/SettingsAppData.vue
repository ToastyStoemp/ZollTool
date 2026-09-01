<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { qrDataUrl } from '@/lib/qr';
import { showToast } from '@/lib/toast';
import { exportBackupJson, exportBackupZipTo, importBackup, importBackupZip } from '@/lib/export/backup-json';
import { saveTextFile, createFileWriter } from '@/lib/download';
import { Updater, hasNativePlugin, isNative } from '@/native/plugins';
import {
  checkForUpdate,
  downloadUpdate,
  installDownloadedUpdate,
  updateDownload,
  type UpdateCheck,
} from '@/lib/updates';
import SettingsShell from './SettingsShell.vue';

const settings = useSettingsStore();
const appVersion = ref(__APP_VERSION__);

// ── Get the Android app: direct APK download + a QR to scan from another device.
// The sync server serves the APK publicly; on web the server is our own origin.
const apkUrl = computed(() => {
  const base = (settings.serverUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
  // Use the compat build — the widest device compatibility for a shared download.
  return base ? `${base}/api/updates/download/compat` : '';
});
const apkQr = ref('');
watch(
  apkUrl,
  async (url) => {
    apkQr.value = url ? await qrDataUrl(url) : '';
  },
  { immediate: true },
);

onMounted(async () => {
  if (hasNativePlugin('Updater')) {
    try {
      appVersion.value = (await Updater.getCurrentVersion()).versionName;
    } catch {
      /* keep the build-time stamp */
    }
  }
});

// ── App updates (native only) ───────────────────────────────────────────────
const updateCheck = ref<UpdateCheck | null>(null);
const updateChecking = ref(false);
const updateError = ref('');

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
    if (!updateCheck.value) updateError.value = 'No update info available — set a server URL under Account & security first.';
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
  if (updateDownload.error) showToast(`Download failed: ${updateDownload.error}`, 'error');
}

// ── Backup ──────────────────────────────────────────────────────────────────
const importInput = ref<HTMLInputElement | null>(null);
const busyBackup = ref(false);
const backupStamp = (): string => new Date().toISOString().slice(0, 10);

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
    showToast(`Imported ${counts.events} events, ${counts.products} products, ${counts.transactions} sales`, 'success');
  } catch (err) {
    showToast(`Import failed: ${err instanceof Error ? err.message : err}`, 'error');
  } finally {
    busyBackup.value = false;
  }
}
</script>

<template>
  <SettingsShell title="App &amp; data">
    <!-- App updates (native only) -->
    <section v-if="isNative" class="zui-card">
      <div class="mb-2 flex items-baseline justify-between gap-3">
        <h2 class="zui-card-title">App updates</h2>
        <span class="text-xs text-slate-500">{{ appVersion }}</span>
      </div>
      <p class="mb-3 text-xs text-slate-500">Checks the sync server for a newer build than this device is running. Needs a server URL set under Account & security.</p>
      <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40" :disabled="updateChecking" @click="checkUpdate">
        {{ updateChecking ? 'Checking…' : 'Check for updates' }}
      </button>
      <p v-if="updateError" class="mt-2 text-xs text-red-400">{{ updateError }}</p>
      <div v-if="updateCheck" class="mt-3 text-sm">
        <p class="text-slate-500">Installed: {{ updateCheck.currentVersionName }}</p>
        <template v-if="updateCheck.available">
          <p class="mt-1 font-medium text-emerald-400">Update available: {{ updateCheck.versionName }}</p>
          <div v-if="updateDownload.active" class="mt-2">
            <div class="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div class="h-full rounded-full bg-emerald-600 transition-all" :style="{ width: (downloadPct ?? 0) + '%' }" />
            </div>
            <p class="mt-1 text-xs text-slate-500">
              {{ downloadPct != null ? `${downloadPct}%` : `${(updateDownload.bytesWritten / 1e6).toFixed(1)} MB` }}
            </p>
          </div>
          <button v-else class="mt-2 zui-btn zui-btn-primary" @click="doDownloadOrInstall">
            {{ downloadReadyForCheck ? 'Install update' : 'Download update' }}
          </button>
        </template>
        <p v-else class="mt-1 text-slate-400">Up to date.</p>
      </div>
    </section>

    <!-- Get the app: download the APK or scan the QR from another device -->
    <section v-if="apkUrl" class="zui-card">
      <h2 class="zui-card-title mb-2">Get the Android app</h2>
      <p class="mb-3 text-xs text-slate-500">
        Install ZollTool on another phone or tablet — download the APK here, or scan this code from that device.
      </p>
      <div class="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <img v-if="apkQr" :src="apkQr" alt="Scan to download the ZollTool app" class="h-40 w-40 shrink-0 rounded-lg bg-white p-2" />
        <div class="min-w-0 flex-1">
          <a :href="apkUrl" download class="inline-block zui-btn zui-btn-primary">Download APK</a>
          <p class="mt-2 break-all text-[0.65rem] text-slate-600">{{ apkUrl }}</p>
          <p class="mt-2 text-xs text-slate-500">On the receiving device, allow installing from this source when Android asks.</p>
        </div>
      </div>
    </section>

    <!-- Backup -->
    <section class="zui-card">
      <h2 class="mb-2 zui-card-title">Backup</h2>
      <p class="mb-3 text-xs text-slate-500">
        Export your data as a <strong>JSON</strong> file (events, products, sales, discounts — small and quick, no photos), or as a full <strong>ZIP</strong> that also bundles every
        product photo. Import accepts either, plus JSON saved by the old ZollTool. Importing merges by id — it never deletes existing data.
      </p>
      <div class="flex flex-wrap gap-2">
        <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40" :disabled="busyBackup" @click="doExportJson">Export JSON</button>
        <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40" :disabled="busyBackup" @click="doExportZip">Export ZIP (with photos)</button>
        <button class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40" :disabled="busyBackup" @click="importInput?.click()">Import backup</button>
        <input ref="importInput" type="file" accept="application/json,.json,application/zip,.zip" class="hidden" @change="onImportFile" />
      </div>
    </section>

    <!-- Legacy -->
    <section class="zui-card">
      <h2 class="mb-2 zui-card-title">Legacy app</h2>
      <p class="mb-3 text-xs text-slate-500">
        The previous version (incl. the customs tool) ships alongside until every feature is ported.
        <span v-if="settings.migratedFromV1">Your old data was imported automatically.</span>
      </p>
      <a href="legacy/index.html" class="inline-block rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700">Open legacy ZollTool</a>
    </section>
  </SettingsShell>
</template>
