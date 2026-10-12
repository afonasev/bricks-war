/** Show a device-local date only when the saved completion timestamp is known. */
export function recordDateMarkup(finishedAt: number | null): string {
  if (finishedAt === null || !Number.isFinite(finishedAt)) return '';
  const date = new Date(finishedAt);
  if (!Number.isFinite(date.getTime())) return '';
  const label = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `<small class="record-date" aria-label="Дата рекорда ${label}">${label}</small>`;
}
