import {launcherPresentation} from './launcher-presentation.mjs';
/* Local sandbox renderer: all release strings are rendered as text, never markup. */
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
  const {kind,copy:t,title,description,version,eyebrow,locale} = launcherPresentation(view);
  document.documentElement.lang = locale;
  document.body.dataset.kind = kind;
  $('title').textContent = title;
  $('description').textContent = description;
  $('version').textContent = version;
  $('eyebrow').textContent = eyebrow;
  $('notes').textContent = t.notes; $('notes').hidden = !view.hasNotes;
  const transferring = kind === 'progress' || kind === 'cancelling';
  $('transfer').hidden = !transferring;
  const percent = Math.max(0, Math.min(100, Math.floor(Number(view.state.progress) || 0)));
  $('progress').value = percent;
  $('percent').textContent = `${percent}%`;
  const actionKey = view.actions.join(',');
  if (changed || $('actions').dataset.key !== actionKey) {
    $('actions').dataset.key = actionKey;
    $('actions').replaceChildren(...view.actions.map(action => {
      const b = document.createElement('button'); b.textContent = t[action]; b.dataset.action = action;
      if (action === 'update' || action === 'retry') b.className = 'primary';
      b.addEventListener('click', () => { void choose(action); }); return b;
    }));
    busy = false;
    if (changed) focus(Math.max(0,buttons().findIndex(b => b.dataset.action === 'play')));
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
