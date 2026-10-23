import { ratingKey, type GlobalRating, type RatingRow } from '../domain/globalRating';
import { RatingOutbox, fetchGlobalRating } from './globalRatingClient';

const escape = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function globalRatingMarkup(data: GlobalRating, names: readonly string[]): string {
  if (!data.top.length) return '<p class="rating-message">Пока нет результатов. Сыграйте первую партию!</p>';
  const selected = new Set(names.map(ratingKey));
  const row = (a: RatingRow, separated = false): string => `<li tabindex="0" data-ui-focus class="${selected.has(ratingKey(a.name)) ? 'is-own-rating' : ''} ${separated ? 'rating-separated' : ''}"><span class="result-place">#${a.rank}</span><span class="record-identity"><strong>${escape(a.name)}</strong></span><span class="record-metrics"><time>${a.lineScore.toLocaleString('ru-RU')}</time></span></li>`;
  return `<ol class="results-list survival-record-list global-rating-list">${data.top.map(a => row(a)).join('')}${data.own.map((a, i) => row(a, i === 0)).join('')}</ol>`;
}

/** Keeps local markup intact; asynchronous content only touches its own mounted panel. */
export class RatingPanels {
  private selected: 'local' | 'global' = 'local';
  private refreshMounted: (() => void) | null = null;
  private active: HTMLElement | null = null;
  readonly outbox = new RatingOutbox();
  start(): void {
    const retry = () => { void this.outbox.flush().then(() => this.refreshMounted?.()).catch(() => undefined); };
    window.addEventListener('online', retry);
    window.setInterval(() => { if (this.outbox.pending().length) retry(); }, 30000);
    retry();
  }
  mount(panel: HTMLElement, names: () => string[], ready: () => boolean = () => true, changed: () => void = () => {}): void {
    this.active = panel;
    const local = document.createElement('div'); local.className = 'rating-local-content';
    const list = panel.querySelector('ol');
    const empty = panel.querySelector(':scope > p');
    if (list) local.append(list); else if (empty) local.append(empty);
    const heading = panel.querySelector('h2,h3'); if (heading) heading.textContent = 'Рейтинг';
    const global = document.createElement('div'); global.className = 'rating-global-content';
    const buttons = document.createElement('div'); buttons.className = 'rating-switch'; buttons.setAttribute('role', 'group'); buttons.setAttribute('aria-label', 'Рейтинг');
    buttons.innerHTML = '<button type="button" data-rating="local" data-ui-focus>Локальный рейтинг</button><button type="button" data-rating="global" data-ui-focus>Глобальный рейтинг</button>';
    panel.append(buttons, local, global);
    let sequence = 0;
    const refresh = async () => {
      if (this.selected !== 'global' || !panel.isConnected || this.active !== panel) return;
      const current = ++sequence;
      global.innerHTML = '<p class="rating-message" role="status">Загружаем рейтинг…</p>';
      try {
        // A failed upload should not prevent reading the public leaders.
        await this.outbox.flush().catch(() => undefined);
        const own = names(); const data = await fetchGlobalRating(own);
        if (current !== sequence || !panel.isConnected || this.active !== panel) return;
        global.innerHTML = globalRatingMarkup(data, own);
        if (this.outbox.pending().length) global.insertAdjacentHTML('beforeend', '<p class="rating-message" role="status">Новые результаты ожидают отправки.</p>');
      } catch {
        if (current === sequence && panel.isConnected) global.innerHTML = '<p class="rating-message" role="status">Рейтинг временно недоступен. Новые результаты отправятся автоматически после восстановления связи.</p>';
      }
    };
    this.refreshMounted = () => { void refresh(); };
    const show = () => {
      if (heading) heading.textContent = this.selected === 'local' ? 'Локальный рейтинг' : 'Глобальный рейтинг';
      panel.dataset.ratingView = this.selected;
      local.hidden = this.selected !== 'local'; global.hidden = this.selected !== 'global';
      buttons.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rating === this.selected)));
    };
    buttons.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-rating]');
      if (!button || !ready()) return;
      this.selected = button.dataset.rating as 'local' | 'global';
      show(); changed(); void refresh();
    });
    show(); void refresh();
  }
  namesChanged(): void { this.refreshMounted?.(); }
}
