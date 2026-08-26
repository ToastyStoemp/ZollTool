import QRCode from 'qrcode';
import jsQR from 'jsqr';

/**
 * Quick-connect QR: one device shows a QR carrying the sync server login,
 * another scans it to fill the login form. Decoding uses a photo from the
 * system camera (same zero-permission pattern as product photos) so it works
 * on old WebViews without getUserMedia or a CAMERA permission.
 */

export interface ConnectPayload {
  url: string;
  email: string;
  password: string;
}

interface ConnectQr {
  zt: 1;
  u: string;
  e: string;
  p: string;
}

export function connectQrDataUrl(payload: ConnectPayload): Promise<string> {
  const qr: ConnectQr = { zt: 1, u: payload.url, e: payload.email, p: payload.password };
  return QRCode.toDataURL(JSON.stringify(qr), { margin: 1, width: 280, errorCorrectionLevel: 'M' });
}

/** Generic QR data-URL for any string — e.g. an otpauth:// URI for 2FA setup. */
export function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Decode a connect QR from a photo. Returns null if no valid code is found. */
export async function decodeConnectQr(file: Blob): Promise<ConnectPayload | null> {
  const bitmap = await loadBitmap(file);
  const w = bitmap.width;
  const h = bitmap.height;

  // Try a few downscales: full-resolution photos are slow (and heavy on old
  // devices), but tiny QRs in a large frame can need the extra pixels.
  for (const maxPx of [1000, 1600]) {
    const scale = Math.min(1, maxPx / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(data.data, data.width, data.height);
    if (code) {
      if ('close' in bitmap) bitmap.close();
      return parsePayload(code.data);
    }
    if (scale === 1) break; // no more resolution to gain
  }
  if ('close' in bitmap) bitmap.close();
  return null;
}

function parsePayload(text: string): ConnectPayload | null {
  try {
    const obj = JSON.parse(text) as Partial<ConnectQr>;
    if (obj?.zt === 1 && typeof obj.u === 'string' && typeof obj.e === 'string' && typeof obj.p === 'string') {
      return { url: obj.u, email: obj.e, password: obj.p };
    }
  } catch {
    /* not our QR */
  }
  return null;
}
