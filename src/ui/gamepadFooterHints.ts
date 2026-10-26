import { faceGlyph } from './inputGlyph';
export { gamepadFaceLabels } from './inputGlyph';
import { html } from '../i18n/locale';

export function showGamepadFooterHints(): boolean {
  return true;
}

export type FooterActionKey = 'confirm' | 'back' | 'select' | 'open' | 'start' | 'reset' | 'join' | 'addAi';

export function gamepadFooterAction(label: FooterActionKey | undefined, action: 'confirm' | 'back' | 'roster' | 'reset' | 'ai'): string {
  if (!label || !showGamepadFooterHints()) return '';
  return `<span class="release-footer-action" data-hint-action="${action}" data-hint-default="${label}">${faceGlyph(action)}<span data-hint-label>${html(label)}</span></span>`;
}

export function gamepadFooterHintsMarkup(reset = false): string {
  return `<div class="release-footer-actions">${reset ? gamepadFooterAction('confirm', 'confirm') : ''}${gamepadFooterAction('back', 'back')}${reset ? footerResetButtonMarkup() : ''}</div>${reset ? '<output data-preferences-status role="status"></output>' : ''}`;
}

export function footerResetButtonMarkup(classes = 'footer-reset'): string {
  return `<button type="button" class="${classes}" data-reset-preferences="all">${showGamepadFooterHints() ? faceGlyph('reset') : ''}<span>${html('reset')}</span></button>`;
}
