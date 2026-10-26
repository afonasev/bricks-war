import { lobbyText } from '../i18n/lobbyCopy';
import { html as tr, text as localeText, translate, getLocale, type Locale } from '../i18n/locale';
import { ratingKey, type GlobalRating, type RatingRow } from '../domain/globalRating';
import { RatingOutbox, fetchGlobalRating } from './globalRatingClient';

const escape = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function globalRatingMarkup(data: GlobalRating, names: readonly string[], locale: Locale = 'ru'): string {
  if (!data.top.length) return `<p class="rating-message">${escape(translate(locale, 'ratingEmpty'))}</p>`;
  const selected = new Set(names.map(ratingKey));
  const row = (a: RatingRow, separated = false): string => `<li tabindex="0" data-ui-focus class="${selected.has(ratingKey(a.name)) ? 'is-own-rating' : ''} ${separated ? 'rating-separated' : ''}"><span class="result-place">#${a.rank}</span><span class="record-identity"><strong>${escape(a.name)}</strong></span><span class="record-metrics"><time>${a.lineScore.toLocaleString(locale)}</time></span></li>`;
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
  mount(panel: HTMLElement, names: () => string[], ready: () => boolean = () => true, changed: () => void = () => {}, labels?: {local: string; global: string; title: string}): void {
    this.active = panel;
    const local = document.createElement('div'); local.className = 'rating-local-content';
    const list = panel.querySelector('ol');
    const empty = panel.querySelector(':scope > p');
    if (list) local.append(list); else if (empty) local.append(empty);
    const heading = panel.querySelector('h2,h3'); if (heading) heading.textContent = localeText('ratingTitle');
    const global = document.createElement('div'); global.className = 'rating-global-content';
    const buttons = document.createElement('div'); buttons.className = 'rating-switch'; buttons.setAttribute('role', 'group'); buttons.setAttribute('aria-label', localeText('ratingTitle'));
    buttons.innerHTML = `<button type="button" data-rating="local" data-ui-focus>${labels ? escape(labels.local) : tr('ratingLocal')}</button><button type="button" data-rating="global" data-ui-focus>${labels ? escape(labels.global) : tr('ratingGlobal')}</button>`;
    panel.append(buttons, local, global);
    let sequence = 0;
    const refresh = async () => {
      if (this.selected !== 'global' || !panel.isConnected || this.active !== panel) return;
      const current = ++sequence;
      global.innerHTML = `<p class="rating-message" role="status">${tr('ratingLoading')}</p>`;
      try {
        // A failed upload should not prevent reading the public leaders.
        await this.outbox.flush().catch(() => undefined);
        const own = names(); const data = await fetchGlobalRating(own);
        if (current !== sequence || !panel.isConnected || this.active !== panel) return;
        global.innerHTML = globalRatingMarkup(data, own, getLocale());
        if (this.outbox.pending().length) global.insertAdjacentHTML('beforeend', `<p class="rating-message" role="status">${tr('ratingPending')}</p>`);
      } catch {
        if (current === sequence && panel.isConnected) global.innerHTML = `<p class="rating-message" role="status">${tr('ratingUnavailable')}</p><button type="button" class="rating-retry" data-rating-retry data-ui-focus>${lobbyText('Повторить')}</button>`;
      }
    };
    global.addEventListener('click', event => { if ((event.target as Element).closest('[data-rating-retry]')) void refresh(); });
    this.refreshMounted = () => { void refresh(); };
    const show = () => {
      if (heading) heading.textContent = labels?.title ?? (this.selected === 'local' ? localeText('ratingLocal') : localeText('ratingGlobal'));
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
