import { LOCALES, LANGUAGE_NAMES, getLocale, html } from './locale';

export function languageSettingsMarkup(): string {
  return `<section class="release-panel settings-language-section" aria-label="${html('language')}"><label class="settings-action"><span><strong>${html('language')}</strong><small>${html('languageHint')}</small></span><select data-language aria-label="${html('language')}" data-menu-select-layout="dropdown">${LOCALES.map(locale => `<option value="${locale}" lang="${locale}" ${getLocale() === locale ? 'selected' : ''}>${LANGUAGE_NAMES[locale]}</option>`).join('')}</select></label><output data-language-status class="settings-status" role="status"></output></section>`;
}
