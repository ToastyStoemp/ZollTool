import { reactive } from 'vue';
import { Updater, hasNativePlugin } from '@/native/plugins';

export type Flavor = 'carbon' | 'compat' | 'full';

/**
 * There's no direct "which flavor am I" API — infer it from which
 * flavor-specific native plugin is present (see build.gradle's
 * carbonImplementation/fullImplementation split). compat ships neither.
 */
export function currentFlavor(): Flavor | null {
  if (hasNativePlugin('CarbonPayment')) return 'carbon';
  if (hasNativePlugin('SumUp')) return 'full';
  if (hasNativePlugin('Screen')) return 'compat';
  return null;
}

export interface UpdateCheck {
  versionCode: number;
  versionName: string;
  currentVersionCode: number;
  currentVersionName: string;
  available: boolean;
  downloadUrl: string;
}

/** Compares this install's version against the sync server's published one. Null when self-update isn't possible here. */
export async function checkForUpdate(serverUrl: string): Promise<UpdateCheck | null> {
  const flavor = currentFlavor();
  if (!flavor || !hasNativePlugin('Updater') || !serverUrl) return null;

  const current = await Updater.getCurrentVersion();
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/updates/latest`);
  if (!res.ok) return null;
  const latest = (await res.json()) as { versionCode: number; versionName: string };

  return {
    versionCode: latest.versionCode,
    versionName: latest.versionName,
    currentVersionCode: current.versionCode,
    currentVersionName: current.versionName,
    available: latest.versionCode > current.versionCode,
    downloadUrl: `${serverUrl.replace(/\/$/, '')}/api/updates/download/${flavor}`,
  };
}

export interface UpdateDownloadState {
  active: boolean;
  /** Downloaded and waiting for the user to install. */
  ready: boolean;
  bytesWritten: number;
  /** -1 when the server didn't send a Content-Length. */
  totalBytes: number;
  error: string;
  /** versionName this download corresponds to — lets callers detect a stale
   *  "ready" download if a newer build got published since it finished. */
  versionName: string;
}

/**
 * Shared across the background auto-check (App.vue) and the Settings page,
 * so both reflect the same in-flight download instead of racing two.
 */
export const updateDownload = reactive<UpdateDownloadState>({
  active: false,
  ready: false,
  bytesWritten: 0,
  totalBytes: -1,
  error: '',
  versionName: '',
});

let progressListenerAttached = false;
function ensureProgressListener(): void {
  if (progressListenerAttached || !hasNativePlugin('Updater')) return;
  progressListenerAttached = true;
  void Updater.addListener('updateDownloadProgress', (e) => {
    updateDownload.bytesWritten = e.bytesWritten;
    updateDownload.totalBytes = e.totalBytes;
  });
}

/** No-ops if a download is already in flight or this version is already downloaded and ready. */
export async function downloadUpdate(check: UpdateCheck): Promise<void> {
  if (updateDownload.active || (updateDownload.ready && updateDownload.versionName === check.versionName)) {
    return;
  }
  ensureProgressListener();
  updateDownload.active = true;
  updateDownload.ready = false;
  updateDownload.error = '';
  updateDownload.bytesWritten = 0;
  updateDownload.totalBytes = -1;
  updateDownload.versionName = check.versionName;
  try {
    await Updater.download({ url: check.downloadUrl });
    updateDownload.ready = true;
  } catch (err) {
    updateDownload.error = err instanceof Error ? err.message : String(err);
  } finally {
    updateDownload.active = false;
  }
}

export async function installDownloadedUpdate(): Promise<void> {
  await Updater.install();
}
