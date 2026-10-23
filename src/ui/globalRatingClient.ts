import { isRatingAttempt, ratingKey, type GlobalRating, type RatingAttempt } from '../domain/globalRating';

export const RATING_OUTBOX_KEY = 'bricks-war:global-rating-outbox:v1';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const browserStorage = (): StorageLike | null => { try { return localStorage; } catch { return null; } };

export class RatingOutbox {
  private memory: RatingAttempt[] = [];
  private storageWriteFailed = false;
  private sending: Promise<void> | null = null;
  constructor(private readonly storage: StorageLike | null = browserStorage(), private readonly send = submitRating) {}
  pending(): RatingAttempt[] {
    if (this.storageWriteFailed) return [...this.memory];
    try {
      const data: unknown = JSON.parse(this.storage?.getItem(RATING_OUTBOX_KEY) ?? '[]');
      const saved = Array.isArray(data) ? data.filter(isRatingAttempt) : [];
      return this.best([...saved, ...this.memory]);
    } catch { return [...this.memory]; }
  }
  private best(attempts: readonly RatingAttempt[]): RatingAttempt[] {
    const entries = new Map<string, RatingAttempt>();
    for (const a of attempts) {
      const key = ratingKey(a.name);
      if (!entries.has(key) || entries.get(key)!.lineScore < a.lineScore) entries.set(key, a);
    }
    return [...entries.values()];
  }
  private save(attempts: RatingAttempt[]): void {
    this.memory = attempts;
    try { this.storage?.setItem(RATING_OUTBOX_KEY, JSON.stringify(attempts)); }
    catch { this.storageWriteFailed = true; /* Do not re-read an acknowledged, read-only snapshot. */ }
  }
  enqueue(attempts: readonly RatingAttempt[]): void { this.save(this.best([...this.pending(), ...attempts.filter(isRatingAttempt)])); }
  flush(): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = this.drain().finally(() => { this.sending = null; });
    return this.sending;
  }
  private async drain(): Promise<void> {
    while (this.pending().length) {
      const batch = this.pending().slice(0, 4);
      await this.send(batch);
      this.save(this.pending().filter(a => !batch.some(sent => JSON.stringify(sent) === JSON.stringify(a))));
    }
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`/api/network/${path}`, { method: body ? 'POST' : 'GET', cache: 'no-store',
      signal: controller.signal, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error('Рейтинг временно недоступен');
    return await response.json() as T;
  } finally { clearTimeout(timer); }
}
async function submitRating(attempts: readonly RatingAttempt[]): Promise<void> {
  const result = await request<{ ok: boolean }>('rating-submit', { attempts });
  if (result.ok !== true) throw new Error('Результат не подтверждён');
}
export async function fetchGlobalRating(names: readonly string[]): Promise<GlobalRating> {
  const query = new URLSearchParams();
  [...new Set(names)].slice(0, 4).forEach(name => query.append('name', name));
  const data = await request<GlobalRating>(`rating?${query}`);
  if (!data || !Array.isArray(data.top) || !Array.isArray(data.own) || data.top.length > 10 || data.own.length > 4
    || ![...data.top, ...data.own].every(a => isRatingAttempt(a) && Number.isSafeInteger(a.rank) && a.rank > 0)) {
    throw new Error('Некорректный ответ рейтинга');
  }
  return data;
}
