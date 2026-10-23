import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalRatingStore } from '../server/globalRating';
import { createNetworkServer } from '../server/http';
import { isRatingAttempt, type RatingAttempt } from '../src/domain/globalRating';

const attempt = (name: string, lineScore: number): RatingAttempt => ({ name, lineScore, elapsedMs: 1000, finishedAt: 1700000000000 });
const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

it('persists one best per normalized name across restart, preserves equal metadata and serializes concurrent improvements', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bricks-rating-')); directories.push(dir);
  const file = join(dir, 'records.json'), store = new GlobalRatingStore(file);
  await store.submit([attempt(' Анна   Мария ', 100)]);
  await store.submit([{ ...attempt('анна мария', 100), elapsedMs: 9999 }]);
  expect((await store.read([])).top[0]).toMatchObject({ name: 'Анна Мария', elapsedMs: 1000 });
  await Promise.all([store.submit([attempt('АННА МАРИЯ', 300)]), store.submit([attempt('анна мария', 200)]), store.submit([attempt('Другой', 250)])]);
  const restarted = new GlobalRatingStore(file);
  expect((await restarted.read([])).top.map(a => [a.name, a.lineScore])).toEqual([['АННА МАРИЯ', 300], ['Другой', 250]]);
  expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1);
});

it('returns stable top ten, shared ranks and distinct selected rows beyond ten, even with rank ten ties', async () => {
  const store = new GlobalRatingStore();
  for (let i = 0; i < 12; i++) await store.submit([attempt(`P${i}`, i < 9 ? 100 - i : 50)]);
  const data = await store.read(['p0', 'P10', ' P10 ', 'P11']);
  expect(data.top).toHaveLength(10);
  expect(data.top[9]).toMatchObject({ name: 'P9', rank: 10 });
  expect(data.own.map(a => [a.name, a.rank])).toEqual([['P10', 10], ['P11', 10]]);
  await store.submit([attempt('P11', 100)]);
  expect((await store.read([])).top.slice(0, 2).map(a => [a.name, a.rank])).toEqual([['P0', 1], ['P11', 1]]);
});

it('fails closed on corrupt storage and does not acknowledge unwritable storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bricks-rating-')); directories.push(dir);
  const file = join(dir, 'bad'); await writeFile(file, '{broken');
  await expect(new GlobalRatingStore(file).submit([attempt('A', 10)])).rejects.toThrow();
  expect(await readFile(file, 'utf8')).toBe('{broken');
  const blocked = new GlobalRatingStore(join(file, 'child.json'));
  await expect(blocked.submit([attempt('A', 10)])).rejects.toThrow();
});

it('rejects malformed numeric values and empty/control names', async () => {
  for (const value of [{ ...attempt('A', 1), lineScore: -1 }, { ...attempt('A', 1), lineScore: Infinity }, attempt(' ', 1), attempt('A\nB', 1), { ...attempt('A', 1), elapsedMs: NaN }]) expect(isRatingAttempt(value)).toBe(false);
  await expect(new GlobalRatingStore().submit(Array.from({ length: 5 }, () => attempt('A', 1)))).rejects.toThrow();
});

it('real HTTP reads/submits without disturbing network health; rejects foreign origins and oversized batches', async () => {
  const runtime = createNetworkServer();
  await new Promise<void>(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(runtime.server.address() as { port: number }).port}`;
  const post = (attempts: unknown, source = origin) => fetch(`${origin}/api/network/rating-submit`, { method: 'POST', headers: { Origin: source, 'Content-Type': 'application/json' }, body: JSON.stringify({ attempts }) });
  try {
    expect((await post([attempt('A', 100)], 'https://foreign.invalid')).status).toBe(400);
    expect((await post([attempt('A', 100), attempt('B', 200)])).status).toBe(200);
    const data = await (await fetch(`${origin}/api/network/rating?name=A`)).json();
    expect(data.top.map((a: RatingAttempt) => a.name)).toEqual(['B', 'A']);
    expect((await post(Array.from({ length: 5 }, () => attempt('A', 1)))).status).toBe(400);
    expect((await fetch(`${origin}/api/network/rating?${new URLSearchParams(Array.from({ length: 5 }, () => ['name', 'A']))}`)).status).toBe(400);
    expect((await (await fetch(`${origin}/api/network/health`)).json()).ok).toBe(true);
  } finally { await runtime.close(); }
});

it('HTTP reports storage failure without leaking paths or acknowledging the score', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bricks-rating-')); directories.push(dir);
  const file = join(dir, 'corrupt.json'); await writeFile(file, '{broken');
  const runtime = createNetworkServer(undefined, [], undefined, false, new GlobalRatingStore(file));
  await new Promise<void>(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(runtime.server.address() as { port: number }).port}`;
  try {
    const read = await fetch(`${origin}/api/network/rating`);
    expect(read.status).toBe(503); expect(await read.text()).not.toContain(dir);
    const write = await fetch(`${origin}/api/network/rating-submit`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ attempts: [attempt('A', 5)] }) });
    expect(write.status).toBe(503); expect(await write.text()).not.toContain(dir);
    expect(await readFile(file, 'utf8')).toBe('{broken');
  } finally { await runtime.close(); }
});
