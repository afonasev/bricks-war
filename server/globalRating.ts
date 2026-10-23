import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isRatingAttempt, ratingKey, ratingName, type GlobalRating, type RatingAttempt } from '../src/domain/globalRating';

/** One process owns this snapshot. null is an isolated in-memory store for tests. */
export class GlobalRatingStore {
  private records: RatingAttempt[] | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string | null = null) {}

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async load(): Promise<RatingAttempt[]> {
    if (this.records) return this.records;
    if (!this.file) return this.records = [];
    let data: unknown;
    try { data = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.records = []; throw error; }
    const entries = (data as { version?: unknown; records?: unknown })?.records;
    if ((data as { version?: unknown })?.version !== 1 || !Array.isArray(entries) || !entries.every(isRatingAttempt)
      || new Set(entries.map(a => ratingKey(a.name))).size !== entries.length) throw new Error('Invalid global rating snapshot');
    return this.records = entries;
  }
  submit(attempts: readonly RatingAttempt[]): Promise<void> {
    return this.serialized(async () => {
      if (attempts.length < 1 || attempts.length > 4 || !attempts.every(isRatingAttempt)) throw new Error('Invalid rating attempts');
      const next = [...await this.load()];
      let changed = false;
      for (const attempt of attempts) {
        const index = next.findIndex(a => ratingKey(a.name) === ratingKey(attempt.name));
        if (index >= 0 && next[index]!.lineScore >= attempt.lineScore) continue;
        // Appending improvements establishes stable server achievement order for ties.
        if (index >= 0) next.splice(index, 1);
        next.push({ name: ratingName(attempt.name), lineScore: attempt.lineScore, elapsedMs: attempt.elapsedMs, finishedAt: attempt.finishedAt }); changed = true;
      }
      if (!changed) return;
      if (this.file) {
        await mkdir(dirname(this.file), { recursive: true });
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temporary, 'wx', 0o600);
          try { await handle.writeFile(JSON.stringify({ version: 1, records: next })); await handle.sync(); }
          finally { await handle.close(); }
          await rename(temporary, this.file);
        } finally { await unlink(temporary).catch(() => undefined); }
      }
      this.records = next;
    });
  }
  read(names: readonly string[]): Promise<GlobalRating> {
    return this.serialized(async () => {
      if (names.length > 4 || names.some(n => typeof n !== 'string' || n.length > 80)) throw new Error('Invalid rating names');
      const sorted = [...await this.load()].sort((a, b) => b.lineScore - a.lineScore);
      let rank = 0;
      const rows = sorted.map((record, index) => {
        if (!index || sorted[index - 1]!.lineScore > record.lineScore) rank = index + 1;
        return { ...record, rank };
      });
      const selected = new Set(names.map(ratingKey));
      return { top: rows.slice(0, 10), own: rows.slice(10).filter(r => selected.has(ratingKey(r.name))) };
    });
  }
}
