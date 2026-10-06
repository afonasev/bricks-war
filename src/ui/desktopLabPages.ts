import { isMobilePlayViewport } from './mobileSettings';

interface LabPage { group: HTMLElement; card: HTMLElement | null; fields: HTMLElement[]; title: string }

/** Keep live controls mounted so paging never resets unsaved tuning values. */
export function configureDesktopLabPages(root: HTMLElement, onPageChange: () => void): void {
  const content = root.querySelector<HTMLElement>('.debug-lab-content');
  if (!content) return;
  const groups = [...content.querySelectorAll<HTMLElement>(':scope > .debug-group')];
  const fields = groups.flatMap(group => [...group.querySelectorAll<HTMLElement>('.debug-field')]);
  const cards = groups.flatMap(group => [...group.querySelectorAll<HTMLElement>('.debug-ai-card')]);
  root.querySelector('.desktop-lab-pages')?.remove();
  if (isMobilePlayViewport()) {
    groups.forEach(el => { el.hidden = false; }); fields.forEach(el => { el.hidden = false; }); cards.forEach(el => { el.hidden = false; });
    return;
  }
  const capacity = 4;
  const pages: LabPage[] = [];
  groups.forEach(group => {
    const title = group.querySelector('h2')?.textContent ?? '';
    const groupCards = [...group.querySelectorAll<HTMLElement>('.debug-ai-card')];
    const owners = groupCards.length ? groupCards : [group];
    owners.forEach(owner => {
      const items = [...owner.querySelectorAll<HTMLElement>('.debug-field')];
      for (let i = 0; i < items.length; i += capacity) pages.push({ group, card: owner === group ? null : owner, fields: items.slice(i, i + capacity), title: title + (owner === group ? '' : ` · ${owner.querySelector('h3')?.textContent ?? ''}`) });
    });
  });
  let page = Math.min(Number(content.dataset.labPage ?? 0), pages.length - 1);
  const nav = document.createElement('nav'); nav.className = 'desktop-lab-pages'; nav.setAttribute('aria-label', 'Разделы лаборатории');
  nav.innerHTML = '<button type="button" data-lab-previous data-ui-focus>← Предыдущий раздел</button><output aria-live="polite"></output><button type="button" data-lab-next data-ui-focus>Следующий раздел →</button>';
  content.before(nav);
  const render = () => {
    const current = pages[page]; if (!current) return;
    groups.forEach(el => { el.hidden = el !== current.group; });
    cards.forEach(el => { el.hidden = el !== current.card; });
    fields.forEach(el => { el.hidden = !current.fields.includes(el); });
    nav.querySelector('output')!.textContent = `${page + 1} / ${pages.length} · ${current.title}`;
    nav.querySelector<HTMLButtonElement>('[data-lab-previous]')!.disabled = page === 0;
    nav.querySelector<HTMLButtonElement>('[data-lab-next]')!.disabled = page === pages.length - 1;
    content.dataset.labPage = String(page);
  };
  nav.querySelector('[data-lab-previous]')!.addEventListener('click', () => { page--; render(); onPageChange(); });
  nav.querySelector('[data-lab-next]')!.addEventListener('click', () => { page++; render(); onPageChange(); });
  render();
}
