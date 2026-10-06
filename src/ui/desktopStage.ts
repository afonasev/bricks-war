/** Menus share one logical composition; the game canvas retains physical coordinates. */
export function configureDesktopStage(root: HTMLElement): void {
  const desktop = root.dataset.layout === 'desktop' && !root.classList.contains('network-root');
  const menu = root.querySelector('main:not(.arena-screen)');
  let stage = root.querySelector<HTMLElement>(':scope > .desktop-menu-stage');
  if (!desktop || !menu) {
    if (stage) { stage.replaceWith(...stage.childNodes); }
  } else {
    if (!stage) {
      stage = document.createElement('div'); stage.className = 'desktop-menu-stage';
      stage.append(...root.childNodes); root.append(stage);
    } else {
      stage.append(...[...root.childNodes].filter(node => node !== stage));
    }
  }
  const scale = Math.min((innerWidth - 32) / 1120, (innerHeight - 32) / 640);
  root.style.setProperty('--desktop-scale', String(scale));
  root.style.setProperty('--desktop-x', `${(innerWidth - 1120 * scale) / 2}px`);
  root.style.setProperty('--desktop-y', `${(innerHeight - 640 * scale) / 2}px`);
}
