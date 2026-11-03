import { text } from '../i18n/locale';

/** Shared non-interactive start title; decoration is excluded from spoken status. */
export function readyTitleMarkup(): string {
  return graphicTitleMarkup(text('matchReady'));
}

/** Plain text only: editable event titles use the same lettering as the ready title. */
export function graphicTitleMarkup(title: string): string {
  const escaped = title.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]!));
  return `<span class="ready-title"><span class="ready-blocks ready-blocks-left" aria-hidden="true"><i></i><i></i></span><span class="ready-label">${escaped}</span><span class="ready-blocks ready-blocks-right" aria-hidden="true"><i></i><i></i></span></span>`;
}

export function localizeReadyTitle(element: HTMLElement): void {
  const label = element.querySelector('.ready-label');
  if (label) label.textContent = text('matchReady');
}
