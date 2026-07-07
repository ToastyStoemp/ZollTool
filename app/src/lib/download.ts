import { FileShare, hasNativePlugin } from '@/native/plugins';
import { showToast } from './toast';

/** Save a text file: SAF dialog on Android (FileSharePlugin), download on web. */
export async function saveTextFile(filename: string, content: string, mimeType: string): Promise<void> {
  if (hasNativePlugin('FileShare')) {
    const result = await FileShare.saveToDevice({ filename, content });
    if (result.saved) showToast(`Saved ${filename}`, 'success');
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Share a text file via the Android share sheet; falls back to download. */
export async function shareTextFile(filename: string, content: string, mimeType: string): Promise<void> {
  if (hasNativePlugin('FileShare')) {
    await FileShare.shareFile({ filename, content, mimeType });
    return;
  }
  await saveTextFile(filename, content, mimeType);
}

/** Save a binary file (base64 payload): SAF dialog on Android, download on web. */
export async function saveBinaryFile(filename: string, base64: string, mimeType: string): Promise<void> {
  if (hasNativePlugin('FileShare')) {
    const result = await FileShare.saveToDevice({ filename, content: base64, mimeType, encoding: 'base64' });
    if (result.saved) showToast(`Saved ${filename}`, 'success');
    return;
  }
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
