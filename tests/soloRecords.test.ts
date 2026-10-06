import { describe, expect, it } from 'vitest';
import { loadSoloRecords, saveSoloRecord, saveSurvivalRecords, SOLO_RECORDS_STORAGE_KEY } from '../src/ui/soloRecords';

function memory(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set(SOLO_RECORDS_STORAGE_KEY, initial);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
}

describe('solo records', () => {
  it('orders, trims, and preserves a top ten', () => {
    const store = memory();
    for (let index = 0; index < 11; index += 1) saveSoloRecord({ name: `P${index}`, elapsedMs: index * 1000, lineScore: index, total: index }, store);
    const records = loadSoloRecords(store);
    expect(records).toHaveLength(10);
    expect(records[0]?.total).toBe(10);
    expect(records.at(-1)?.total).toBe(1);
  });

  it('preserves completion metadata while keeping legacy records readable', () => {
    const store = memory(JSON.stringify([{ name: 'Старый', elapsedMs: 1_000, lineScore: 100, total: 100 }]));
    const saved = saveSoloRecord({ name: 'Новый', elapsedMs: 2_000, lineScore: 200, finishedAt: 1_700_000_000_000, placedPieces: 42 }, store);
    expect(saved.records[0]).toMatchObject({ name: 'Новый', finishedAt: 1_700_000_000_000, placedPieces: 42 });
    expect(saved.records.find((record) => record.name === 'Старый')).toMatchObject({ finishedAt: null, placedPieces: null });
  });

  it('rejects malformed local data and reports an unranked result', () => {
    const bad = memory('{bad');
    expect(loadSoloRecords(bad)).toEqual([]);
    const store = memory(JSON.stringify(Array.from({ length: 10 }, (_, index) => ({ name: `P${index}`, elapsedMs: 1000, lineScore: 0, total: 100 - index }))));
    expect(saveSoloRecord({ name: 'Low', elapsedMs: 1, lineScore: 0, total: 1 }, store).ranked).toBe(false);
  });

  it('ranks only line-clear points and identifies the exact current attempts', () => {
    const store = memory(JSON.stringify([
      { id: 'older', name: 'Юля', elapsedMs: 202_900, lineScore: 5_700, total: 7_729 },
      { id: 'legacy', name: 'Юля', elapsedMs: 202_900, lineScore: 3_220, total: 5_249 },
    ]));
    const result = saveSurvivalRecords([
      { id: 'current-yulia', name: 'Юля', elapsedMs: 202_900, lineScore: 3_220 },
      { id: 'current-anya', name: 'Аня', elapsedMs: 100_000, lineScore: 4_900 },
    ], store);
    expect(result.records.map((record) => record.id)).toEqual(['older', 'current-anya', 'legacy', 'current-yulia']);
    expect(result.rankedIds).toEqual(['current-yulia', 'current-anya']);
    expect(loadSoloRecords(store).find((record) => record.id === 'legacy')?.total).toBe(3_220);
  });

  it('reports a current attempt below the top ten without highlighting an older match', () => {
    const store = memory(JSON.stringify(Array.from({ length: 10 }, (_, index) => ({
      id: `old-${index}`, name: 'Юля', elapsedMs: 1_000, lineScore: 1_000 - index, total: 1_000 - index,
    }))));
    const result = saveSurvivalRecords([{ id: 'current-low', name: 'Юля', elapsedMs: 1_000, lineScore: 0 }], store);
    expect(result.rankedIds).toEqual([]);
    expect(result.unranked.map((record) => record.id)).toEqual(['current-low']);
  });
});
