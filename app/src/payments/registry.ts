import type { PaymentProvider, PaymentProviderId } from './provider';
import { manualProvider } from './manual';
import { myposGo2Provider } from './mypos-go2';
import { myposCarbonProvider } from './mypos-carbon';
import { myposGlassProvider } from './mypos-glass';
import { bridgeProvider, bridgeConnection } from './bridge-ws';
import { sumupProvider } from './sumup';

const providers: PaymentProvider[] = [
  manualProvider,
  myposGo2Provider,
  myposCarbonProvider,
  myposGlassProvider,
  bridgeProvider,
  sumupProvider,
];

export function allProviders(): PaymentProvider[] {
  return providers;
}

export function getProvider(id: PaymentProviderId | undefined): PaymentProvider {
  return providers.find((p) => p.id === id) ?? manualProvider;
}

export async function availableProviders(): Promise<PaymentProvider[]> {
  const flags = await Promise.all(providers.map((p) => p.isAvailable()));
  return providers.filter((_, i) => flags[i]);
}

/** Keep the bridge socket alive only while the bridge is the active provider. */
export function onActiveProviderChanged(id: PaymentProviderId): void {
  if (id === 'bridge') bridgeConnection.connect();
  else bridgeConnection.disconnect();
}
