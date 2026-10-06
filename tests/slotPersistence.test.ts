import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SLOT_SELECTIONS,
  loadSlotSelections,
  saveSlotSelections,
  SLOT_SELECTION_STORAGE_KEY,
} from '../src/ui/slotPersistence';
import {
  DEFAULT_PLAYER_NAMES,
  loadPlayerNames,
  PLAYER_NAME_STORAGE_KEY,
  savePlayerNames,
} from '../src/ui/playerNamePersistence';
import {
  MATCH_OPTION_SELECTIONS_STORAGE_KEY,
  loadMatchOptionSelections,
  saveMatchOptionSelections,
} from '../src/ui/matchOptionsPersistence';
import { DEFAULT_MATCH_OPTION_SELECTIONS } from '../src/simulation/matchOptions';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(SLOT_SELECTION_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function optionStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(MATCH_OPTION_SELECTIONS_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('participant slot persistence', () => {
  it('uses the shipped composition when nothing has been saved', () => {
    expect(loadSlotSelections(memoryStorage())).toEqual(DEFAULT_SLOT_SELECTIONS);
  });

  it('restores the last human, AI difficulty, and disabled selections', () => {
    const storage = memoryStorage();
    const selections = ['ai-expert', 'human-1', 'off', 'ai-hard'] as const;
    saveSlotSelections(selections, storage);
    expect(loadSlotSelections(storage)).toEqual(selections);
  });

  it('falls back safely for malformed or unknown saved values', () => {
    expect(loadSlotSelections(memoryStorage('{broken'))).toEqual(DEFAULT_SLOT_SELECTIONS);
    expect(loadSlotSelections(memoryStorage(JSON.stringify(['ai-expert', 'unknown', 'off', 'ai-hard'])))).toEqual([
      'ai-expert', 'human-2', 'off', 'ai-hard',
    ]);
  });
});

describe('human player name persistence', () => {
  it('uses default names until a local name has been chosen', () => {
    expect(loadPlayerNames(memoryStorage())).toEqual(DEFAULT_PLAYER_NAMES);
  });

  it('restores a compact saved name for each human control scheme', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    savePlayerNames(['Аня', 'Дима', 'Коля', 'Лена'], storage);
    expect(loadPlayerNames(storage)).toEqual(['Аня', 'Дима', 'Коля', 'Лена']);
  });

  it('normalizes malformed and overly long saved names safely', () => {
    const storage = {
      getItem: (key: string) => key === PLAYER_NAME_STORAGE_KEY ? JSON.stringify(['   ', 'Очень длинное имя для игры', 'Коля', 'Лена']) : null,
      setItem: () => undefined,
    };
    expect(loadPlayerNames(storage)).toEqual(['Игрок 1', 'Очень длинное имя', 'Коля', 'Лена']);
  });
});

describe('match option persistence', () => {
  it('restores until-victory and falls back to timed for missing or invalid policies', () => {
    const storage = optionStorage();
    const selections = { ...DEFAULT_MATCH_OPTION_SELECTIONS, battleTimeMode: 'until-victory' as const };
    saveMatchOptionSelections(selections, storage);
    expect(loadMatchOptionSelections(storage)).toEqual(selections);
    expect(loadMatchOptionSelections(optionStorage('{}')).battleTimeMode).toBe('timed');
    expect(loadMatchOptionSelections(optionStorage('{"battleTimeMode":"invalid"}')).battleTimeMode).toBe('timed');
  });
  it('uses free-for-all All Opponents defaults for old or absent setup data', () => {
    expect(loadMatchOptionSelections(optionStorage())).toEqual(DEFAULT_MATCH_OPTION_SELECTIONS);
    expect(loadMatchOptionSelections(optionStorage(JSON.stringify({ conflictEnabled: false })))).toEqual({
      ...DEFAULT_MATCH_OPTION_SELECTIONS,
      conflictEnabled: false,
    });
  });

  it('restores valid variant and conflict targeting selections safely', () => {
    const storage = optionStorage();
    const selections = { ...DEFAULT_MATCH_OPTION_SELECTIONS, matchVariant: 'teams' as const, conflictTargeting: 'hunt-leader' as const };
    saveMatchOptionSelections(selections, storage);
    expect(loadMatchOptionSelections(storage)).toEqual(selections);
    expect(loadMatchOptionSelections(optionStorage(JSON.stringify({ matchVariant: 'invalid', conflictTargeting: 'invalid' })))).toEqual(DEFAULT_MATCH_OPTION_SELECTIONS);
  });
});
