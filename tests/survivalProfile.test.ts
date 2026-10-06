import { describe, expect, it } from 'vitest';
import { SURVIVAL_PROFILE_KEY, loadSurvivalProfile, saveSurvivalProfile } from '../src/ui/survivalProfile';

describe('survival profile persistence', () => {
  it('keeps the Survival identity separate and falls back safely', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    saveSurvivalProfile({ name: '  Аня  ', controller: 'human-2', tileStyle: 'classic' }, storage);
    expect(loadSurvivalProfile(storage)).toEqual({ name: 'Аня', controller: 'human-2', tileStyle: 'classic' });
    values.set(SURVIVAL_PROFILE_KEY, '{bad');
    expect(loadSurvivalProfile(storage)).toMatchObject({ name: 'Игрок 1', controller: 'human-1' });
  });
});
