export interface RatingAttempt {
  name: string;
  lineScore: number;
  elapsedMs: number;
  finishedAt: number;
}
export interface RatingRow extends RatingAttempt { rank: number }
export interface GlobalRating { top: RatingRow[]; own: RatingRow[] }

export function ratingName(name: string): string { return name.trim().replace(/\s+/g, ' '); }
export function ratingKey(name: string): string { return ratingName(name).toLocaleLowerCase('ru-RU'); }
export function isRatingAttempt(value: unknown): value is RatingAttempt {
  if (!value || typeof value !== 'object') return false;
  const a = value as RatingAttempt;
  return typeof a.name === 'string' && ratingName(a.name).length > 0 && a.name.length <= 80
    && !/[\u0000-\u001f\u007f]/.test(a.name)
    && Number.isSafeInteger(a.lineScore) && a.lineScore >= 0
    && Number.isSafeInteger(a.elapsedMs) && a.elapsedMs >= 0
    && Number.isSafeInteger(a.finishedAt) && a.finishedAt > 0;
}
