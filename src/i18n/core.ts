// Translation table: French and English, one key per string (French is the fallback).
// No React Native import here: the domain tests use it in Node.
import { en, type MessageKey } from './en';
import { fr } from './fr';
import type { Lang } from './lang';

export { deviceLanguage, resolveLanguage, type Lang } from './lang';
export type { MessageKey } from './en';
type Value = string | { one: string; other: string };
type Params = Record<string, string | number>;

const tables: Record<Lang, Record<MessageKey, Value>> = { fr, en };

export function translate(lang: Lang, key: MessageKey | string, params: Params = {}): string {
  const value = (tables[lang] as Record<string, Value>)[key] ?? (tables.fr as Record<string, Value>)[key] ?? key;
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    // Hermes (Android) has no Intl.PluralRules. French: 0 and 1 are singular; English: only 1.
    const count = Math.abs(Number(params.count ?? 0));
    const one = lang === 'fr' ? count < 2 : count === 1;
    text = one ? value.one : value.other;
  }
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] !== undefined ? String(params[name]) : match));
}

// Formatted by hand: no dependency on Intl, which is partial in Hermes on Android.
const MONTHS: Record<Lang, string[]> = {
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const pad = (value: number) => String(value).padStart(2, '0');

/** Today: a time ("17:04", "05:04 PM"). Earlier: a short date ("13 oct.", "Oct 13"). */
export const formatTime = (lang: Lang, at: number | string | undefined) => {
  if (at === undefined || at === null || at === '') return '';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const hours = date.getHours();
  if (sameDay)
    return lang === 'fr' ? `${pad(hours)}:${pad(date.getMinutes())}` : `${pad(hours % 12 || 12)}:${pad(date.getMinutes())} ${hours < 12 ? 'AM' : 'PM'}`;
  return lang === 'fr' ? `${date.getDate()}\u00a0${MONTHS.fr[date.getMonth()]}` : `${MONTHS.en[date.getMonth()]} ${date.getDate()}`;
};

export const formatDuration = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
};
