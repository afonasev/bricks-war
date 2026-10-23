import { catalogs } from './catalogs';
import { LANGUAGE_KEY, normalizeLocale, resolveLocale } from './locale';

/** Synchronous, self contained classic script: no network/module failure can delay the first localized paint. */
export function startupLocaleScript(): string {
  const keys = ['title', 'loading', 'loadingAria', 'errorTitle', 'errorHelp', 'reload', 'unknown', 'unavailable', 'available', 'error', 'stack'] as const;
  const boot = Object.fromEntries(Object.entries(catalogs).map(([locale, catalog]) => [locale, Object.fromEntries(keys.map(key => [key, catalog[key]]))]));
  return `(()=>{const normalizeLocale=${normalizeLocale.toString()};const resolveLocale=${resolveLocale.toString()};let stored;try{stored=localStorage.getItem(${JSON.stringify(LANGUAGE_KEY)})}catch{}const locale=resolveLocale(stored,navigator.languages||[navigator.language]);window.__bricksLocale={locale,copy:${JSON.stringify(boot)}[locale]};document.documentElement.lang=locale;document.title=window.__bricksLocale.copy.title;})();`;
}
