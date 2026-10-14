// Translations and formatting (core.ts), plus the React hook bound to the language preference.
import { useStore } from 'zustand';

import { appStore } from '../state/app';
import { translate } from './core';
import { resolveLanguage } from './lang';

export * from './core';

/** Hook: the translate function for the current language preference. */
export function useT() {
  const preference = useStore(appStore, (state) => state.prefs.language);
  const lang = resolveLanguage(preference);
  return Object.assign((key: string, params?: Record<string, string | number>) => translate(lang, key, params), { lang });
}

