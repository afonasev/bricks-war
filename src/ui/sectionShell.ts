import logo from '../assets/brand/concept-logo.webp';
import { text } from '../i18n/locale';
import { lobbyText } from '../i18n/lobbyCopy';
import { faceGlyph } from './inputGlyph';
import type { AppScreen } from './screenRouter';
import './sectionShell.css';
import './laboratory.css';

const sections = { settings: 'settings', controls: 'controls', rules: 'rules', laboratory: 'lab', history: 'releaseHistory' } as const;

/** Reuse the existing controls and handlers; only their shared chrome moves. */
export function configureSectionShell(root: HTMLElement, screen: AppScreen, backToMenu = screen === 'settings'): void {
  if (!(screen in sections)) return;
  const main = root.querySelector<HTMLElement>(`main[data-screen="${screen}"]`);
  if (!main || main.classList.contains('section-shell')) return;
  const back = main.querySelector<HTMLButtonElement>('#settings-back, #controls-back, #rules-back, #close-debug-lab, [data-history-back]');
  if (!back) return;
  const header = main.querySelector<HTMLElement>('header');
  if (!header) return;
  const title = document.createElement('h1'); title.id = header.querySelector('h1')?.id ?? ''; title.textContent = text(sections[screen as keyof typeof sections]);
  const brand = document.createElement('img'); brand.src = logo; brand.alt = 'Bricks War'; brand.className = 'section-brand';
  const progress = main.querySelector('#rules-progress');
  const toolbar = document.createElement('div'); toolbar.className = 'section-toolbar';
  if (screen === 'laboratory') {
    header.querySelectorAll(':scope > p, :scope > .debug-lab-actions').forEach(item => toolbar.append(item));
  }
  back.remove();
  back.classList.add('section-back');
  back.innerHTML = `${faceGlyph('back')}<span>${backToMenu ? lobbyText('В меню') : text('settings')}</span>`;
  header.replaceChildren(brand, title);
  if (progress) header.append(progress);
  header.className = 'section-heading';
  const navigation = document.createElement('nav'); navigation.className = 'section-navigation';
  navigation.append(back);
  main.querySelectorAll(':scope > footer').forEach(item => item.remove());
  const content = document.createElement('div'); content.className = 'section-content';
  if (toolbar.childNodes.length) content.append(toolbar);
  [...main.children].filter(child => child !== header).forEach(child => content.append(child));
  main.append(content, navigation);
  main.classList.add('section-shell');
}
