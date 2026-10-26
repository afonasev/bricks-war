import './controllerIcon.css';
import { translate, type Locale } from '../i18n/locale';
/** Controller identity is derived from the bound slot, never the last input event. */
export function controllerIcon(controller: string, locale: Locale = 'ru'): string {
  const pad = controller.startsWith('gamepad-');
  const kind = pad ? 'gamepad' : controller === 'human-1' ? 'wasd' : controller === 'human-2' ? 'arrows' : controller === 'mobile-touch' ? 'touch' : 'bot';
  const number = pad ? Number(controller.slice(8)) + 1 : 0;
  const label = kind === 'gamepad' ? translate(locale, 'gamepadIndex', {index: number}) : kind === 'wasd' ? translate(locale, 'keyboardWasd') : kind === 'arrows' ? translate(locale, 'keyboardArrows') : kind === 'touch' ? translate(locale, 'touchController') : translate(locale, 'aiLabel');
  const keys = (letters: string[]) => letters.map((letter, i) => `<g transform="translate(${i ? 5 + (i - 1) * 18 : 23},${i ? 29 : 10})"><rect width="16" height="16" rx="4"/><text x="8" y="12">${letter}</text></g>`).join('');
  const drawing = kind === 'wasd' ? keys(['W','A','S','D']) : kind === 'arrows' ? keys(['↑','←','↓','→']) : kind === 'gamepad'
    ? `<path d="M16 13h32c7 0 13 25 8 29-5 4-13-8-15-8H23c-2 0-10 12-15 8-5-4 1-29 8-29Z"/><path class="icon-detail" d="M19 20v12m-6-6h12"/><circle class="icon-dot" cx="45" cy="22" r="3"/><circle class="icon-dot" cx="50" cy="29" r="3"/><text class="icon-device-number" x="33" y="28">${number}</text>`
    : kind === 'touch' ? '<rect x="17" y="5" width="30" height="46" rx="7"/><path class="icon-detail" d="M28 11h8m-7 34h6"/>'
    : '<rect x="6" y="22" width="7" height="14" rx="3"/><rect x="51" y="22" width="7" height="14" rx="3"/><rect x="12" y="13" width="40" height="33" rx="12"/><path d="M25 13v-3h14v3"/><circle class="icon-dot" cx="24" cy="28" r="3"/><circle class="icon-dot" cx="40" cy="28" r="3"/><path class="icon-detail" d="M27 36q5 4 10 0"/>';
  const viewBox = kind === 'touch' ? '12 0 40 56' : kind === 'bot' ? '3 8 58 43' : kind === 'gamepad' ? '3 8 58 39' : '1 6 62 44';
  return `<span class="controller-icon controller-${kind}" role="img" aria-label="${label}" title="${label}" data-controller="${kind}"><svg viewBox="${viewBox}" aria-hidden="true">${drawing}</svg></span>`;
}
