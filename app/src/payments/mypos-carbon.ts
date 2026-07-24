import type { PaymentProvider, PaymentRequest, PaymentResult, ProviderStatus } from './provider';
import { CarbonPayment, hasNativePlugin } from '@/native/plugins';
import { logDiagnostic } from '@/lib/diagnostics';

/** MyPOS Carbon/Smart on-device payment via intent (CarbonPaymentPlugin.kt). */
export const myposCarbonProvider: PaymentProvider = {
  id: 'mypos-carbon',
  label: 'MyPOS Carbon (on-device)',

  async isAvailable(): Promise<boolean> {
    return hasNativePlugin('CarbonPayment');
  },

  async getStatus(): Promise<ProviderStatus> {
    if (!hasNativePlugin('CarbonPayment')) return { connected: false, detail: 'MyPOS device only' };
    try {
      const { connected, detail } = await CarbonPayment.getStatus();
      return { connected, detail: detail ?? (connected ? 'Terminal ready' : undefined) };
    } catch (err) {
      return { connected: false, detail: String(err) };
    }
  },

  async startPayment(req: PaymentRequest): Promise<PaymentResult> {
    logDiagnostic(`CarbonPayment.startPayment amount=${req.amount} currency=${req.currency}`);
    const result = await CarbonPayment.startPayment({ amount: req.amount, currency: req.currency });
    logDiagnostic(
      `CarbonPayment.startPayment result approved=${!!result.approved}` +
        (result.error ? ` error=${result.error}` : ''),
    );
    return {
      approved: !!result.approved,
      provider: 'mypos-carbon',
      txRef: result.transactionId,
      cardBrand: result.cardBrand,
      authCode: result.authCode,
      error: result.error,
    };
  },

  async cancel(): Promise<void> {
    // Intent-based flow — cancellation happens on the terminal UI itself.
  },
};
