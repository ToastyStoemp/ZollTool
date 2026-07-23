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

export async function installUpdate(downloadUrl: string): Promise<void> {
  await Updater.downloadAndInstall({ url: downloadUrl });
}
