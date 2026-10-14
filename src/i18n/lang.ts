export type Lang = 'fr' | 'en';

export function deviceLanguage(): Lang {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  } catch {
    return 'fr';
  }
}

export const resolveLanguage = (preference: Lang | 'system'): Lang => (preference === 'system' ? deviceLanguage() : preference);
