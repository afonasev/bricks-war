import { expect, it, vi } from 'vitest';
import { RatingOutbox, RATING_OUTBOX_KEY } from '../src/ui/globalRatingClient';
import { globalRatingMarkup } from '../src/ui/ratingPanel';
import type { RatingAttempt } from '../src/domain/globalRating';
const a = (name: string, lineScore: number): RatingAttempt => ({ name, lineScore, elapsedMs: 1000, finishedAt: 1700000000000 });
const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };

it('does not upload historical local records; coalesces only new attempts and survives restart/offline failure', async () => {
  const storage = memory(); storage.setItem('bricks-war:solo-records:v1', JSON.stringify([a('Legacy', 999)]));
  const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const first = new RatingOutbox(storage, send);
  expect(first.pending()).toEqual([]);
  first.enqueue([a('A', 10), a(' a ', 20), a('B', 5)]);
  await expect(first.flush()).rejects.toThrow('offline');
  const restarted = new RatingOutbox(storage, send);
  expect(restarted.pending().map(r => r.lineScore)).toEqual([20, 5]);
  await restarted.flush(); expect(JSON.parse(storage.getItem(RATING_OUTBOX_KEY)!)).toEqual([]);
  expect(send.mock.calls[1]![0].map((r: RatingAttempt) => r.name)).toEqual([' a ', 'B']);
});

it('acknowledges only the sent attempt and delivers a better attempt added in flight', async () => {
  let acknowledge!: () => void;
  const sent: RatingAttempt[][] = [];
  const outbox = new RatingOutbox(memory(), async attempts => {
    sent.push([...attempts]);
    if (sent.length === 1) await new Promise<void>(resolve => { acknowledge = resolve; });
  });
  outbox.enqueue([a('A', 10)]); const sending = outbox.flush();
  expect(outbox.flush()).toBe(sending);
  outbox.enqueue([a('a', 20), a('B', 5)]); acknowledge(); await sending;
  expect(sent.map(batch => batch.map(r => r.lineScore))).toEqual([[10], [20, 5]]);
  expect(outbox.pending()).toEqual([]);
});

it('keeps trying in session when localStorage is unavailable and sends batches of at most four', async () => {
  const calls: number[] = [];
  const storage = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
  const outbox = new RatingOutbox(storage, async attempts => { calls.push(attempts.length); });
  outbox.enqueue(Array.from({ length: 6 }, (_, i) => a(`P${i}`, i)));
  await outbox.flush(); expect(calls).toEqual([4, 2]); expect(outbox.pending()).toEqual([]);
});

it('escapes names, marks selected rows and renders actual ranks after the leaders', () => {
  const markup = globalRatingMarkup({ top: [{ ...a('<script>', 10), rank: 1 }], own: [{ ...a('A', 5), rank: 137 }] }, ['a']);
  expect(markup).toContain('&lt;script&gt;'); expect(markup).not.toContain('<script>');
  expect(markup).toContain('#137'); expect(markup).toContain('is-own-rating rating-separated');
});

it('does not endlessly re-send an acknowledged snapshot when storage becomes read-only', async () => {
  const saved = JSON.stringify([a('A', 10)]);
  const send = vi.fn().mockResolvedValue(undefined);
  const outbox = new RatingOutbox({ getItem: () => saved, setItem: () => { throw new Error('quota'); } }, send);
  await outbox.flush();
  expect(send).toHaveBeenCalledTimes(1); expect(outbox.pending()).toEqual([]);
});
