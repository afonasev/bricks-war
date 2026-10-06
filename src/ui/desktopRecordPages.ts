import { isMobilePlayViewport } from './mobileSettings';

/** Page overflow records while keeping the match results and actions visible. */
export function configureDesktopRecordPages(root: HTMLElement, onPageChange: () => void): void {
  const list = root.querySelector<HTMLOListElement>('.survival-record-list, .survival-records ol');
  if (!list) return;
  const items = [...list.querySelectorAll<HTMLElement>(':scope > li')];
  root.querySelector('.desktop-record-pages')?.remove();
  if (isMobilePlayViewport()) { items.forEach(item => { item.hidden = false; }); return; }
  const size = 4;
  const count = Math.ceil(items.length / size);
  let page = Math.min(Number(list.dataset.page ?? 0), Math.max(0, count - 1));
  const nav = document.createElement('nav');
  nav.className = 'desktop-record-pages'; nav.setAttribute('aria-label', 'Страницы рекордов');
  nav.innerHTML = '<button type="button" data-record-previous data-ui-focus>← Предыдущие</button><output aria-live="polite"></output><button type="button" data-record-next data-ui-focus>Следующие →</button>';
  nav.hidden = count <= 1;
  list.after(nav);
  const render = () => {
    items.forEach((item,index) => { item.hidden = Math.floor(index / size) !== page; });
    list.dataset.page = String(page);
    nav.querySelector('output')!.textContent = `${page + 1} / ${count}`;
    nav.querySelector<HTMLButtonElement>('[data-record-previous]')!.disabled = page === 0;
    nav.querySelector<HTMLButtonElement>('[data-record-next]')!.disabled = page >= count - 1;
  };
  nav.querySelector('[data-record-previous]')!.addEventListener('click', () => { page--; render(); onPageChange(); });
  nav.querySelector('[data-record-next]')!.addEventListener('click', () => { page++; render(); onPageChange(); });
  render();
}
