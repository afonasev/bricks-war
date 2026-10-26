import { getLocale, html as tr } from '../i18n/locale';
import controlsGamepadPanelUrl from '../assets/controls-gamepad-gameplay.png';

/** Keep the approved raster controller/connector layer intact; labels are a locale-aware SVG layer. */
export function gamepadControlsArtworkMarkup(): string {
  if (getLocale() === 'ru') return `<img class="approved-gamepad-artwork" src="${controlsGamepadPanelUrl}" width="1000" height="720" alt="${tr('controlsGamepadAlt')}" />`;
  return `<svg class="approved-gamepad-artwork localized-gamepad-artwork" viewBox="0 0 1000 720" role="img" aria-label="${tr('controlsGamepadAlt')}" xmlns="http://www.w3.org/2000/svg">
    <image href="${controlsGamepadPanelUrl}" width="1000" height="720" />
    <g fill="#fffcef"><rect x="480" y="0" width="150" height="37"/><rect x="20" y="251" width="155" height="40"/><rect x="316" y="523" width="256" height="37"/><rect x="680" y="523" width="155" height="37"/></g>
    <g fill="#081744" font-family="system-ui,sans-serif" font-weight="750" text-anchor="middle">
      <text data-gamepad-label="pause" x="550" y="28" font-size="27">${tr('controlsPause')}</text>
      <text data-gamepad-label="move" x="99" y="283" font-size="25">${tr('controlsMove')}</text>
      <text data-gamepad-label="drop" x="444" y="549" font-size="24">${tr('controlsDrop')}</text>
      <text data-gamepad-label="rotate" x="756" y="549" font-size="27">${tr('controlsRotate')}</text>
    </g>
  </svg>`;
}
