import { html as tr, text } from '../i18n/locale';

/** Shared non-interactive start title; decoration is excluded from spoken status. */
export function readyTitleMarkup(): string {
  return `<span class="ready-title"><span class="ready-blocks ready-blocks-left" aria-hidden="true"><i></i><i></i></span><span class="ready-label">${tr('matchReady')}</span><span class="ready-blocks ready-blocks-right" aria-hidden="true"><i></i><i></i></span></span>`;
}

export function localizeReadyTitle(element: HTMLElement): void {
  const label = element.querySelector('.ready-label');
  if (label) label.textContent = text('matchReady');
}
