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
  downloadBlob(filename, bytesToBlob(arr, mimeType));
}

/** Uint8Array<ArrayBufferLike> isn't structurally a BlobPart under TS 5.7+ typed arrays; cast at the boundary. */
function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes as unknown as BlobPart], { type });
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Chunked base64 encode — btoa(String.fromCharCode(...arr)) blows the call stack on large arrays. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ── Streamed file writing ────────────────────────────────────────────────────
// For large exports (ZIP backups with photos). Shipping the whole payload plus
// its base64 across the bridge in one message OOM-crashes old Android WebViews.
// A FileWriter passes data through in bounded chunks instead: natively via the
// FileShare streaming session, on web by collecting Blob parts (fine there).

export interface FileWriter {
  write(chunk: Uint8Array): Promise<void>;
  /** Finalize the file (closes the native stream / triggers the web download). */
  close(): Promise<void>;
  /** Best-effort cleanup after a failure. */
  abort(): Promise<void>;
}

/** Returns null if the user cancelled the native save dialog. */
export async function createFileWriter(filename: string, mimeType: string): Promise<FileWriter | null> {
  if (hasNativePlugin('FileShare')) {
    const res = await FileShare.beginSave({ filename, mimeType });
    if (!res.opened) return null;
    return {
      async write(chunk: Uint8Array): Promise<void> {
        await FileShare.writeChunk({ data: bytesToBase64(chunk) });
      },
      async close(): Promise<void> {
        const { saved } = await FileShare.endSave();
        if (saved) showToast(`Saved ${filename}`, 'success');
      },
      async abort(): Promise<void> {
        await FileShare.abortSave().catch(() => {});
      },
    };
  }

  const parts: BlobPart[] = [];
  return {
    async write(chunk: Uint8Array): Promise<void> {
      parts.push(chunk as unknown as BlobPart);
    },
    async close(): Promise<void> {
      downloadBlob(filename, new Blob(parts, { type: mimeType }));
    },
    async abort(): Promise<void> {
      parts.length = 0;
    },
  };
}
