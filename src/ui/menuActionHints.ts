import { lobbyText } from '../i18n/lobbyCopy';
import { text } from '../i18n/locale';
/** Describe the selected control; preferences already save as they change. */
export function refreshMenuActionHints(root: HTMLElement, selected: HTMLElement | null): void {
  root.querySelectorAll<HTMLElement>('[data-hint-action="confirm"]').forEach(hint => {
    const label = hint.querySelector<HTMLElement>('[data-hint-label]');
    const badge = hint.querySelector<HTMLElement>('[data-face-action]');
    const range = selected?.matches('input[type="range"]') ?? false;
    if (badge) badge.hidden = range;
    if (label) label.textContent = range ? `← → ${lobbyText('Изменить')}` : selected?.matches('input[type="checkbox"], select, [data-menu-select]') ? lobbyText('Изменить') : text('select');
  });
  root.querySelectorAll<HTMLElement>('[data-hint-action="back"] [data-hint-label]').forEach(label => {
    label.textContent = root.querySelector('[data-release-history]') ? lobbyText('Закрыть') : root.querySelector('[data-virtual-keyboard], [data-display-confirm], .menu-select.is-open') ? lobbyText('Отменить') : text('back');
  });
}
