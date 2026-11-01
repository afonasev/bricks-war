import { lobbyText } from '../i18n/lobbyCopy';
import { text } from '../i18n/locale';
/** Describe the selected control; preferences already save as they change. */
export function refreshMenuActionHints(root: HTMLElement, selected: HTMLElement | null): void {
  root.querySelectorAll<HTMLElement>('[data-hint-action="confirm"]').forEach(hint => {
    const label = hint.querySelector<HTMLElement>('[data-hint-label]');
    const badge = hint.querySelector<HTMLElement>('[data-face-action]');
    const range = selected?.matches('input[type="range"]') ?? false;
    const preference = root.dataset.inputMode === 'gamepad' && Boolean(selected?.closest('.settings-screen, #pause-settings-panel, [data-network-preferences]'));
    const editing = selected?.hasAttribute('data-gamepad-editing');
    if (badge) badge.hidden = range && !preference;
    if (label) label.textContent = editing ? text('keyboardDone') : preference && selected?.matches('input[type="range"], input[type="checkbox"], select, [data-menu-select-trigger]') ? lobbyText('Изменить') : range ? `← → ${lobbyText('Изменить')}` : selected?.matches('input[type="checkbox"], select, [data-menu-select]') ? lobbyText('Изменить') : text('select');
  });
  root.querySelectorAll<HTMLElement>('[data-hint-action="back"] [data-hint-label]').forEach(label => {
    label.textContent = root.querySelector('[data-release-history]') ? lobbyText('Закрыть') : root.querySelector('[data-virtual-keyboard], [data-display-confirm], .menu-select.is-open, [data-gamepad-editing]') ? lobbyText('Отменить') : text('back');
  });
}
