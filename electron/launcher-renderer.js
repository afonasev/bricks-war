/* Local sandbox renderer: all release strings are rendered as text, never markup. */
const copy = {
  en: {
    offer: 'Update Bricks War?', progress: 'Downloading update', installing: 'Installing update', cancelling: 'Cancelling update',
    failure: 'Update interrupted', unavailable: 'Update unavailable', recovery: 'Previous version restored', blocked: 'Unable to start the game',
    offerBody: 'A new version is available. The game will start automatically after the update.',
    progressBody: 'The game will start automatically when the update is ready.', installingBody: 'Please wait while the verified update is applied.',
    cancellingBody: 'Stopping the download before starting the installed game.',
    failureBody: 'The installed game is preserved. Try again or start playing.', recoveryBody: 'The working game is ready. You can start playing.',
    unavailableBody: 'This update cannot be installed automatically. You can play the installed version.',
    blockedBody: 'The working version could not be confirmed. Close the launcher and repair the installation.',
    play: 'Play now', update: 'Update and launch', retry: 'Try again', quit: 'Close', cancel: 'Cancel',
    hint: 'Keyboard or controller · choose and confirm', verifying: 'Verifying update', version: 'Version', notes: 'What’s new on GitHub',
  },
  ru: {
    offer: 'Обновить Bricks War?', progress: 'Загружаем обновление', installing: 'Устанавливаем обновление', cancelling: 'Отменяем обновление',
    failure: 'Обновление прервалось', unavailable: 'Обновление недоступно', recovery: 'Прежняя версия восстановлена', blocked: 'Не удалось запустить игру',
    offerBody: 'Доступна новая версия. После обновления игра запустится автоматически.',
    progressBody: 'Когда обновление будет готово, игра откроется сама.', installingBody: 'Подождите, применяем проверенное обновление.',
    cancellingBody: 'Останавливаем загрузку перед запуском установленной игры.',
    failureBody: 'Установленная игра сохранена. Можно повторить или начать играть.', recoveryBody: 'Рабочая игра готова. Можно начать играть.',
    unavailableBody: 'Это обновление нельзя установить автоматически. Можно играть в установленную версию.',
    blockedBody: 'Не удалось подтвердить рабочую версию. Закройте лаунчер и восстановите установку.',
    play: 'Играть сейчас', update: 'Обновить и запустить', retry: 'Повторить', quit: 'Закрыть', cancel: 'Отменить',
    hint: 'Клавиатура или контроллер · выбор и подтверждение', verifying: 'Проверяем обновление', version: 'Версия', notes: 'Что нового на GitHub',
  },
};
const $ = id => document.getElementById(id);
let current, busy = false, held = new Set(), previousPads = new Map();
const buttons = () => [...document.querySelectorAll('main button:not(:disabled):not([hidden])')];
function focus(index) {
  const list = buttons(); if (!list.length) return;
  list.forEach(b => b.classList.remove('controller-focus'));
  const button = list[(index + list.length) % list.length]; button.focus(); button.classList.add('controller-focus');
}
function move(delta) { const list = buttons(); focus(Math.max(0, list.indexOf(document.activeElement)) + delta); }
async function choose(action) {
  if (busy || !current?.actions.includes(action)) return;
  busy = true;
  buttons().forEach(b => { b.disabled = true; });
  try { await window.bricksLauncher.choose(current.id, action); } catch { /* Main process may already be closing this window. */ }
  await refresh();
}
function render(view) {
  const changed = current?.id !== view.id;
  current = view;
  const t = copy[view.locale?.startsWith('ru') ? 'ru' : 'en'];
  document.documentElement.lang = view.locale?.startsWith('ru') ? 'ru' : 'en';
  const kind = view.kind === 'failure' ? view.playable === false ? 'blocked'
    : view.unavailable ? 'unavailable' : view.recovery ? 'recovery' : 'failure' : view.kind;
  $('title').textContent = kind === 'progress' && view.state.phase === 'verifying' ? t.verifying : t[kind];
  $('description').textContent = t[`${kind}Body`];
  $('notes').textContent = t.notes; $('notes').hidden = !view.hasNotes;
  const transferring = kind === 'progress' || kind === 'cancelling';
  $('transfer').hidden = !transferring;
  const percent = Math.max(0, Math.min(100, Math.floor(Number(view.state.progress) || 0)));
  $('progress').value = percent;
  $('percent').textContent = `${percent}%`;
  $('hint').textContent = kind === 'offer' && view.state.version ? `${t.version} ${view.state.version}` : view.actions.length ? t.hint : '';
  const actionKey = view.actions.join(',');
  if (changed || $('actions').dataset.key !== actionKey) {
    $('actions').dataset.key = actionKey;
    $('actions').replaceChildren(...view.actions.map(action => {
      const b = document.createElement('button'); b.textContent = t[action]; b.dataset.action = action;
      if (action === 'update' || action === 'retry') b.className = 'primary';
      b.addEventListener('click', () => { void choose(action); }); return b;
    }));
    busy = false;
    if (changed) focus(kind === 'offer' ? buttons().findIndex(b => b.dataset.action === 'update') : 0);
  }
}
$('notes').addEventListener('click', () => { if (!busy && current?.hasNotes) void window.bricksLauncher.notes(current.id).catch(() => {}); });
async function refresh() {
  try { const view = await window.bricksLauncher.state(); if (view?.kind) render(view); } catch { /* Process transition. */ }
}
document.addEventListener('keydown', event => {
  if (event.repeat || held.has(event.code)) { if (['Enter', 'Space'].includes(event.code)) event.preventDefault(); return; }
  held.add(event.code);
  if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.code)) {
    event.preventDefault(); move(['ArrowLeft', 'ArrowUp'].includes(event.code) ? -1 : 1);
  } else if (event.code === 'Escape') {
    event.preventDefault(); if (current?.actions.includes('cancel')) void choose('cancel');
  } else if (event.code === 'Enter' || event.code === 'Space') {
    event.preventDefault(); document.activeElement?.click();
  }
});
document.addEventListener('keyup', event => held.delete(event.code));
window.addEventListener('blur', () => { held.clear(); previousPads.clear(); });
function gamepad() {
  if (document.hasFocus()) for (const pad of navigator.getGamepads()) {
    if (!pad || pad.mapping !== 'standard') continue;
    const values = [pad.buttons[0]?.pressed, pad.buttons[1]?.pressed,
      pad.buttons[14]?.pressed || pad.buttons[12]?.pressed || pad.axes[0] < -.6 || pad.axes[1] < -.6,
      pad.buttons[15]?.pressed || pad.buttons[13]?.pressed || pad.axes[0] > .6 || pad.axes[1] > .6];
    const previous = previousPads.get(pad.index); previousPads.set(pad.index, values);
    if (!previous) continue; // An already-held button on connection/focus is not consent.
    if (values[2] && !previous[2]) move(-1);
    if (values[3] && !previous[3]) move(1);
    if (values[0] && !previous[0]) document.activeElement?.click();
    if (values[1] && !previous[1] && current?.actions.includes('cancel')) void choose('cancel');
  }
  requestAnimationFrame(gamepad);
}
void refresh(); setInterval(refresh, 150); requestAnimationFrame(gamepad);
