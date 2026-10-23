import { html, text } from '../i18n/locale';
import { isMobilePlayViewport } from './mobileSettings';

export function showGamepadFooterHints(): boolean {
  return !isMobilePlayViewport() || Array.from(navigator.getGamepads?.() ?? []).some(pad => pad?.connected);
}

export type FooterActionKey = 'confirm' | 'back' | 'select' | 'open' | 'start' | 'reset' | 'join' | 'addAi';

export function gamepadFooterAction(label: FooterActionKey | undefined, action: 'confirm' | 'back' | 'roster' | 'reset' | 'ai'): string {
  if (!label || !showGamepadFooterHints()) return '';
  const glyph = action === 'confirm' ? 'A' : action === 'back' ? 'B' : action === 'ai' ? 'X' : 'Y';
  return `<span class="release-footer-action"><b class="input-badge input-${action}" aria-hidden="true">${glyph}</b>${html(label)}</span>`;
}

export function gamepadFooterHintsMarkup(reset = false): string {
  return `<div class="release-footer-actions">${reset ? gamepadFooterAction('confirm', 'confirm') : ''}${gamepadFooterAction('back', 'back')}${reset ? footerResetButtonMarkup() : ''}</div>${reset ? '<output data-preferences-status role="status"></output>' : ''}`;
}

export function gamepadFaceLabels(id: string): readonly [string, string, string, string] {
  if (/dualsense|dualshock|playstation|sony|054c/i.test(id)) return ['✕', '○', '□', '△'];
  if (/nintendo|switch|057e/i.test(id)) return ['B', 'A', 'Y', 'X'];
  if (/xbox|xinput|045e/i.test(id)) return ['A', 'B', 'X', 'Y'];
  return [text('bottom'), text('right'), text('left'), text('top')];
}

export function footerResetButtonMarkup(): string {
  return `<button type="button" class="footer-reset" data-reset-preferences="all">${showGamepadFooterHints() ? '<b class="input-badge input-reset" aria-hidden="true">Y</b>' : ''}<span>${html('reset')}</span></button>`;
}
