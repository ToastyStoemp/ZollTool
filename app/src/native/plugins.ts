import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

interface NativePaymentResult {
  approved: boolean;
  transactionId?: string;
  cardBrand?: string;
  authCode?: string;
  error?: string;
}

export interface MyPosPluginApi {
  /** granted=false means the user denied the Bluetooth/location permission. */
  connectTerminal(): Promise<{ granted: boolean }>;
  getStatus(): Promise<{ connected: boolean }>;
  startPayment(options: { amount: number; currency: string }): Promise<NativePaymentResult>;
  /** Abort the in-flight payment and reset the native state; safe to call when idle. */
  cancelPayment(): Promise<void>;
  addListener(
    eventName: 'terminalStatus',
    listener: (status: { connected: boolean }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export interface CarbonPaymentPluginApi {
  getStatus(): Promise<{ connected: boolean; detail?: string }>;
  startPayment(options: { amount: number; currency: string }): Promise<NativePaymentResult>;
  /** Print pre-formatted lines on the terminal's built-in printer (see lib/receipt.ts). */
  printReceipt(options: { lines: NativeReceiptLine[] }): Promise<{ printed: boolean; status: number; error?: string }>;
}

export interface FileSharePluginApi {
  shareFile(options: {
    filename: string;
    content: string;
    mimeType?: string;
    /** 'base64' for binary payloads (PDF, images); omit for UTF-8 text. */
    encoding?: 'base64';
  }): Promise<{ shared: boolean }>;
  saveToDevice(options: {
    filename: string;
    content: string;
    mimeType?: string;
    encoding?: 'base64';
  }): Promise<{ saved: boolean; cancelled?: boolean }>;
  /** Streamed save for large files: open SAF document, append base64 chunks, close. */
  beginSave(options: { filename: string; mimeType?: string }): Promise<{ opened: boolean; cancelled?: boolean }>;
  writeChunk(options: { data: string }): Promise<void>;
  endSave(): Promise<{ saved: boolean }>;
  abortSave(): Promise<void>;
}

export interface SumUpPluginApi {
  isLoggedIn(): Promise<{ loggedIn: boolean }>;
  login(options: { affiliateKey: string }): Promise<{ loggedIn: boolean; message?: string }>;
  logout(): Promise<void>;
  checkout(options: {
    amount: number;
    currency: string;
    title?: string;
    foreignTxId?: string;
  }): Promise<{ approved: boolean; resultCode: number; txCode?: string; message?: string }>;
}

/** Receipt line as consumed by both printer plugins (see lib/receipt.ts). */
export interface NativeReceiptLine {
  kind: 'text' | 'image' | 'space';
  text?: string;
  align?: 'left' | 'center' | 'right';
  doubleHeight?: boolean;
  imageB64?: string;
}

export interface GlassPaymentPluginApi {
  /** connected = the myPOS Glass app is installed on this phone. */
  getStatus(): Promise<{ connected: boolean; detail?: string }>;
  startPayment(options: { amount: number; currency: string }): Promise<NativePaymentResult>;
}

export interface ThermalPrinterPluginApi {
  /** Bonded Bluetooth devices; requests the BT permission on Android 12+. */
  listPrinters(): Promise<{ printers: Array<{ name: string; address: string }> }>;
  printReceipt(options: {
    address: string;
    lines: NativeReceiptLine[];
  }): Promise<{ printed: boolean; status: number; error?: string }>;
}

export const MyPos = registerPlugin<MyPosPluginApi>('MyPos');
export const CarbonPayment = registerPlugin<CarbonPaymentPluginApi>('CarbonPayment');
export const GlassPayment = registerPlugin<GlassPaymentPluginApi>('GlassPayment');
export const ThermalPrinter = registerPlugin<ThermalPrinterPluginApi>('ThermalPrinter');
export const FileShare = registerPlugin<FileSharePluginApi>('FileShare');
export const SumUp = registerPlugin<SumUpPluginApi>('SumUp');

export function hasNativePlugin(name: string): boolean {
  return isNative && Capacitor.isPluginAvailable(name);
}
