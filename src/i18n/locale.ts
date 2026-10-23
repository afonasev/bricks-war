import { catalogs, en, type MessageKey } from './catalogs';

export const LOCALES = ['ru', 'en', 'fr', 'de', 'es', 'zh-Hans', 'ja'] as const;
export type Locale = typeof LOCALES[number];
export const LANGUAGE_KEY = 'bricks-war:language:v1';
export const LANGUAGE_NAMES: Record<Locale, string> = { ru: 'Русский', en: 'English', fr: 'Français', de: 'Deutsch', es: 'Español', 'zh-Hans': '简体中文', ja: '日本語' };
export interface LocaleStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; }

export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== 'string') return null;
  const family = value.trim().toLowerCase().replaceAll('_', '-').split('-')[0] ?? '';
  if (family === 'zh') return 'zh-Hans';
  return ['ru', 'en', 'fr', 'de', 'es', 'ja'].includes(family) ? family as Locale : null;
}

export function resolveLocale(stored: unknown, preferences: readonly string[]): Locale {
  return normalizeLocale(stored) ?? preferences.map(normalizeLocale).find((value): value is Locale => value !== null) ?? 'en';
}

export function browserLocaleStorage(): LocaleStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
export function loadLocale(preferences: readonly string[], storage: LocaleStorage | null = browserLocaleStorage()): Locale {
  let stored: unknown;
  try { stored = storage?.getItem(LANGUAGE_KEY); } catch { /* blocked storage */ }
  return resolveLocale(stored, preferences);
}
export function saveLocale(locale: Locale, storage: LocaleStorage | null = browserLocaleStorage()): boolean {
  try { if (!storage) return false; storage.setItem(LANGUAGE_KEY, locale); return true; } catch { return false; }
}
let current = loadLocale(typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]);
export function getLocale(): Locale { return current; }
export function setLocale(locale: Locale, storage: LocaleStorage | null = browserLocaleStorage()): boolean {
  current = locale;
  if (typeof window !== 'undefined') (window as Window & { __bricksLocale?: unknown }).__bricksLocale = { locale, copy: catalogs[locale] };
  if (typeof document !== 'undefined') { document.documentElement.lang = locale; document.title = text('title'); }
  return saveLocale(locale, storage);
}

type Params<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | Params<Rest> : never;
type Values<K extends MessageKey> = [Params<typeof en[K]>] extends [never] ? [] : [Record<Params<typeof en[K]>, string | number>];
/** Plain text: escape at HTML boundaries, use textContent for live status. */
export function text<K extends MessageKey>(key: K, ...values: Values<K>): string {
  return translate(current, key, values[0]);
}
export function translate(locale: Locale, key: MessageKey, values?: Record<string, string | number>, resources: Partial<Record<MessageKey, string>> = catalogs[locale]): string {
  const template = resources?.[key] || en[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
}
export function html<K extends MessageKey>(key: K, ...values: Values<K>): string {
  return text(key, ...values).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}
