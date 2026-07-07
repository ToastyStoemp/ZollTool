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
  connectTerminal(): Promise<void>;
  getStatus(): Promise<{ connected: boolean }>;
  startPayment(options: { amount: number; currency: string }): Promise<NativePaymentResult>;
  addListener(
    eventName: 'terminalStatus',
    listener: (status: { connected: boolean }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export interface CarbonPaymentPluginApi {
  getStatus(): Promise<{ connected: boolean }>;
  startPayment(options: { amount: number; currency: string }): Promise<NativePaymentResult>;
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

export const MyPos = registerPlugin<MyPosPluginApi>('MyPos');
export const CarbonPayment = registerPlugin<CarbonPaymentPluginApi>('CarbonPayment');
export const FileShare = registerPlugin<FileSharePluginApi>('FileShare');
export const SumUp = registerPlugin<SumUpPluginApi>('SumUp');

export function hasNativePlugin(name: string): boolean {
  return isNative && Capacitor.isPluginAvailable(name);
}
