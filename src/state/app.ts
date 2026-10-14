// App singletons: the store, the conductor, storage and transport for this platform.
import { Platform } from 'react-native';

import { StudioClient } from '../api/client';
import { directTransport, relayTransport } from '../api/transport';
import { resolveLanguage } from '../i18n/lang';
import { Conductor } from './conductor';
import { hydrate, persistOnChange } from './persist';
import { keyValue, secrets } from './storage';
import { createFleetStore } from './store';

/** Web only: the relay that forwards API calls (Studio refuses cross-origin browsers). */
export function relayOrigin(): string {
  const configured = process.env.EXPO_PUBLIC_RELAY_URL;
  if (configured) return configured;
  if (typeof window === 'undefined') return 'http://127.0.0.1:8790';
  // Metro dev server: the relay runs beside it. Built app: the relay serves the page.
  return window.location.port === '8081' ? 'http://127.0.0.1:8790' : window.location.origin;
}

export const appStore = createFleetStore();

const transport = Platform.OS === 'web' ? relayTransport(relayOrigin()) : directTransport;

export const conductor = new Conductor({
  store: appStore,
  createClient: (machine, token) => new StudioClient({ baseUrl: machine.baseUrl, token, transport }),
  language: () => resolveLanguage(appStore.getState().prefs.language),
});

let booted: Promise<void> | null = null;

export function bootApp() {
  booted ??= (async () => {
    await hydrate(appStore, keyValue, secrets);
    persistOnChange(appStore, keyValue, secrets);
    conductor.start();
  })();
  return booted;
}
