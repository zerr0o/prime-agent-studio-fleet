// Web storage: localStorage of the relay origin (127.0.0.1 on this PC only).
// ponytail: tokens live in localStorage on the web build; a relay-side vault would hide them from the page if needed.
import type { KeyValue, Secrets } from './persist';

const ls = () => (typeof localStorage === 'undefined' ? null : localStorage);

export const keyValue: KeyValue = {
  getItem: async (key) => ls()?.getItem(key) ?? null,
  setItem: async (key, value) => ls()?.setItem(key, value),
  removeItem: async (key) => ls()?.removeItem(key),
};

export const secrets: Secrets = {
  get: async (key) => ls()?.getItem(key) ?? null,
  set: async (key, value) => ls()?.setItem(key, value),
  remove: async (key) => ls()?.removeItem(key),
};
