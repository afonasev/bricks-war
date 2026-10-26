import { translate, type Locale } from '../i18n/locale';

/** Show a device-local date only when the saved completion timestamp is known. */
export function recordDateMarkup(finishedAt: number | null, locale: Locale = 'ru'): string {
  if (finishedAt === null || !Number.isFinite(finishedAt)) return '';
  const date = new Date(finishedAt);
  if (!Number.isFinite(date.getTime())) return '';
  const label = date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const description = translate(locale, 'recordDateAria', { date:label }).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  return `<small class="record-date" aria-label="${description}">${label}</small>`;
}
