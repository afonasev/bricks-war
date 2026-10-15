import type { ClientUpdateState } from './clientUpdate';

export function updatePresentation(state: ClientUpdateState) {
  const busy = ['checking','downloading','verifying','paused'].includes(state.phase ?? '');
  const ready = state.phase === 'ready';
  const failedCheck = state.phase === 'check-error';
  const failedInstall = state.phase === 'install-error';
  return {
    visible: state.available || busy || state.error || failedCheck,
    disabled: state.applying || state.blocked || busy || failedCheck || failedInstall,
    label: state.applying ? 'Обновление…' : state.phase === 'downloading' ? `Загрузка ${Math.floor(state.progress ?? 0)}%`
      : state.phase === 'verifying' ? 'Проверка пакета…' : state.phase === 'paused' ? 'Загрузка приостановлена' : state.phase === 'checking' ? 'Проверка…'
      : failedInstall ? 'Обновление не применено' : failedCheck ? 'Проверка недоступна' : ready ? 'Перезапустить' : state.phase === 'download-error' ? 'Повторить загрузку' : 'Обновить',
    status: state.blocked ? 'Сначала завершите сетевую игру'
      : failedInstall ? 'Рабочая версия сохранена. Повторная установка или следующий выпуск позволят обновить оболочку.'
      : failedCheck ? 'Не удалось проверить обновления. Следующая проверка — при запуске игры.'
      : ready ? 'Обновление готово. Оно применится после выхода при следующем запуске.'
      : state.error ? 'Не удалось скачать обновление. Можно повторить загрузку выбранной версии.'
      : state.phase === 'downloading' ? 'Можно продолжить играть: загрузка приостановится на время матча.'
      : state.version ? `Доступна версия ${state.version}` : '',
  };
}
