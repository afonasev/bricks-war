import type { ClientUpdateState } from './clientUpdate';

export function updatePresentation(state: ClientUpdateState) {
  const busy = state.phase === 'checking' || state.phase === 'downloading';
  const visible = state.available || busy || state.phase === 'error';
  return {
    visible,
    disabled: state.applying || state.blocked || busy,
    label: state.applying ? 'Обновление…' : state.phase === 'downloading' ? 'Загрузка…'
      : state.phase === 'checking' ? 'Проверка…' : state.available ? 'Обновить' : 'Повторить',
    status: state.blocked ? 'Сначала завершите сетевую игру'
      : state.error ? 'Не удалось обновить. Попробуйте ещё раз.'
      : state.phase === 'downloading' ? 'Загружаем новую версию игры' : '',
  };
}
