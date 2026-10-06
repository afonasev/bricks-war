import { describe, expect, it } from 'vitest';
import { cloneGameTuning } from '../src/domain/gameTuning';
import { GAME_TUNING_STORAGE_KEY, loadGameTuning, resetGameTuning, saveGameTuning } from '../src/ui/gameTuningPersistence';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe('game tuning browser persistence', () => {
  it('loads a valid device-local tuning without sharing mutable AI profiles', () => {
    const storage = memoryStorage();
    const tuning = cloneGameTuning();
    tuning.battleDifficulties.normal.startingGravityMs = 640;
    expect(saveGameTuning(tuning, storage)).toBe(true);
    const loaded = loadGameTuning(storage);
    expect(loaded?.battleDifficulties.normal).toMatchObject({ startingGravityMs: 640 });
    loaded!.ai.expert.errorChance = 0.12;
    expect(loadGameTuning(storage)!.ai.expert.errorChance).not.toBe(0.12);
  });

  it('normalizes a legacy saved tuning without message templates', () => {
    const tuning = cloneGameTuning();
    const legacy = { ...tuning } as Record<string, unknown>;
    delete legacy.messages;
    const storage = memoryStorage({ [GAME_TUNING_STORAGE_KEY]: JSON.stringify(legacy) });
    expect(loadGameTuning(storage)?.messages.roundStart).toBe('Поехали!');
  });

  it('migrates the former default attack copy without overwriting custom copy', () => {
    const former = cloneGameTuning();
    former.messages.incomingAttack = 'Атака от {senders} +{rows}';
    const formerStorage = memoryStorage({ [GAME_TUNING_STORAGE_KEY]: JSON.stringify(former) });
    expect(loadGameTuning(formerStorage)?.messages.incomingAttack).toBe('Вас атакует {senders} +{rows}');

    former.messages.incomingAttack = 'Осторожно: {senders}';
    const customStorage = memoryStorage({ [GAME_TUNING_STORAGE_KEY]: JSON.stringify(former) });
    expect(loadGameTuning(customStorage)?.messages.incomingAttack).toBe('Осторожно: {senders}');
  });

  it('ignores absent and malformed local values', () => {
    expect(loadGameTuning(memoryStorage())).toBeNull();
    expect(loadGameTuning(memoryStorage({ [GAME_TUNING_STORAGE_KEY]: '{bad json' }))).toBeNull();
    expect(loadGameTuning(memoryStorage({ [GAME_TUNING_STORAGE_KEY]: JSON.stringify({ startingGravityMs: 1 }) }))).toBeNull();
  });

  it('removes the device-local experiment on reset', () => {
    const storage = memoryStorage();
    expect(saveGameTuning(cloneGameTuning(), storage)).toBe(true);
    expect(resetGameTuning(storage)).toBe(true);
    expect(loadGameTuning(storage)).toBeNull();
  });
});
