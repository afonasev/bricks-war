import { text } from '../i18n/locale';
import './responsivePreferences.css';

const COMPACT = '(max-width: 1000px), (max-height: 760px)';
const remembered = new WeakMap<HTMLElement, Map<string, string>>();
const states = new WeakMap<HTMLElement, { panel: HTMLElement; dispose: () => void }>();
let nextId = 0;

/** Disclose existing controls without cloning inputs or changing their handlers. */
export function configureResponsivePreferences(root: HTMLElement): void {
  const panel = root.querySelector<HTMLElement>('.section-shell[data-screen="settings"], .pause-settings-panel.pause-preferences-grid');
  const previous = states.get(root);
  if (previous?.panel === panel && panel?.querySelector('.preferences-tabs')) return;
  previous?.dispose();
  states.delete(root);
  if (!panel) return;
  // Display has extra native resolution/window controls. Give graphics their own
  // compact category rather than shrinking text or scrolling the native form.
  const display = panel.querySelector<HTMLElement>('.settings-display-section, .pause-display-card');
  const graphics = document.createElement('section');
  graphics.className = 'release-panel settings-section settings-graphics-section pause-preferences-card';
  const heading = document.createElement(panel.matches('.section-shell') ? 'h2' : 'h3');
  heading.textContent = text('graphics');
  graphics.append(heading);
  const graphicRows = display ? Array.from(display.querySelectorAll<HTMLElement>(':scope > .settings-action')).filter(row => row.querySelector('#calm-effects,[data-pause-calm],[data-preference-aa],[data-preference-fps]')) : [];
  graphicRows.forEach(row => graphics.append(row));
  if (graphicRows.length) display?.after(graphics);
  const definitions = [
    ['sound', text('sound'), '.settings-audio-section, .pause-audio-card'],
    ['controls', text('controls'), '.settings-stick-section'],
    ['display', text('display'), '.settings-display-section, .pause-display-card'],
    ['graphics', text('graphics'), '.settings-graphics-section'],
    ['language', text('language'), '.settings-language-section'],
    ['more', text('moreSettings'), '.settings-utility'],
  ] as const;
  const groups = definitions.flatMap(([key, label, selector]) => {
    const element = panel.querySelector<HTMLElement>(selector);
    return element ? [{ key, label, element }] : [];
  });
  if (!groups.length) return;
  const tabs = document.createElement('div');
  tabs.className = 'preferences-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', text('settingsAria'));
  const id = `preferences-${++nextId}`;
  const context = panel.matches('.section-shell') ? 'menu' : panel.hasAttribute('data-network-preferences') ? 'network' : 'pause';
  const memory = remembered.get(root) ?? new Map<string, string>();
  remembered.set(root, memory);
  let active = memory.get(context) ?? groups[0]!.key;
  if (!groups.some(group => group.key === active)) active = groups[0]!.key;
  const media = matchMedia(COMPACT);
  const reset = panel.querySelector<HTMLButtonElement>('.settings-utility [data-reset-preferences]');
  const resetParent = reset?.parentElement;
  const resetNext = reset?.nextSibling ?? null;
  const apply = () => {
    if (reset && resetParent) {
      if (media.matches) panel.querySelector('.section-navigation')?.append(reset);
      else resetParent.insertBefore(reset, resetNext);
    }
    if (display) {
      if (media.matches && graphicRows.length) { graphicRows.forEach(row => graphics.append(row)); display.after(graphics); }
      else { graphicRows.forEach(row => display.append(row)); graphics.hidden = true; }
    }
    panel.classList.toggle('preferences-compact', media.matches);
    tabs.hidden = !media.matches;
    groups.forEach(({ key, element }, index) => {
      const selected = active === key;
      const button = tabs.children[index] as HTMLButtonElement;
      button.setAttribute('aria-selected', String(selected));
      // Every tab remains spatially reachable by the shared menu/gamepad cursor.
      element.hidden = element === graphics && !media.matches || media.matches && !selected;
      if (media.matches) { element.setAttribute('role', 'tabpanel'); element.setAttribute('aria-labelledby', button.id); }
      else { element.removeAttribute('role'); element.removeAttribute('aria-labelledby'); }
    });
    if (media.matches && groups.some(({ element }) => element.hidden && element.contains(document.activeElement))) {
      (tabs.children[groups.findIndex(group => group.key === active)] as HTMLElement).focus({ preventScroll: true });
    }
  };
  groups.forEach(({ key, label, element }) => {
    element.dataset.preferencesCategory = key;
    element.id ||= `${id}-panel-${key}`;
    const button = document.createElement('button');
    button.type = 'button'; button.id = `${id}-tab-${key}`; button.textContent = label;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', element.id);
    button.dataset.uiFocus = '';
    button.addEventListener('click', () => { active = key; memory.set(context, active); apply(); });
    button.addEventListener('keydown', event => {
      if (!['Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const target = event.key === 'Home' ? 0 : groups.length - 1;
      active = groups[target]!.key; memory.set(context, active); apply(); (tabs.children[target] as HTMLElement).focus();
    });
    tabs.append(button);
  });
  const content = panel.querySelector('.section-content');
  if (content) content.prepend(tabs); else panel.querySelector('h2')?.after(tabs);
  media.addEventListener('change', apply);
  apply();
  states.set(root, {
    panel,
    dispose: () => {
      media.removeEventListener('change', apply);
      if (reset && resetParent) resetParent.insertBefore(reset, resetNext);
      tabs.remove();
      graphicRows.forEach(row => display?.append(row));
      graphics.remove();
      groups.forEach(({ element }) => {
        element.hidden = false;
        element.removeAttribute('role');
        element.removeAttribute('aria-labelledby');
      });
      panel.classList.remove('preferences-compact');
    },
  });
}
