import { describe, expect, it } from 'vitest';
import { loadBattleSetup, loadSetupTileStyles, saveMatchSetup, MATCH_SETUP_STORAGE_KEY } from '../src/ui/matchSetupPersistence';
import { MATCH_OPTION_SELECTIONS_STORAGE_KEY } from '../src/ui/matchOptionsPersistence';

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
describe('match setup preferences', () => {
  it('defaults new Battle variants to enabled all-opponent attacks and until victory', () => {
    for (const mode of ['battle', 'team-battle'] as const) {
      const setup = loadBattleSetup(mode, storage());
      expect(setup.options).toMatchObject({ battleTimeMode: 'until-victory', conflictEnabled: true, conflictTargeting: 'all-opponents', matchVariant: mode === 'battle' ? 'free-for-all' : 'teams' });
      expect(setup.durationMinutes).toBe(5);
    }
  });
  it('round-trips independent options, numeric time and unresolved figure styles', () => {
    const store = storage();
    const battle = loadBattleSetup('battle', store);
    Object.assign(battle.options, { battleTimeMode: 'timed', conflictEnabled: false, battleDifficulty: 'sport', conflictTargeting: 'hunt-leader' });
    battle.durationMinutes = 7;
    saveMatchSetup('battle', battle, ['sea-crystals', 'random', 'classic', 'marmalade'], store);
    const team = loadBattleSetup('team-battle', store);
    team.durationMinutes = 9;
    saveMatchSetup('team-battle', team, loadSetupTileStyles(store), store);
    saveMatchSetup('survival', { ...battle, options: { ...battle.options, conflictEnabled: false } }, loadSetupTileStyles(store), store);
    expect(loadBattleSetup('battle', store)).toEqual(battle);
    expect(loadBattleSetup('team-battle', store)).toEqual(team);
    expect(loadSetupTileStyles(store)).toEqual(['sea-crystals', 'random', 'classic', 'marmalade']);
  });
  it('migrates explicit legacy timed/off/leader choices without modifying the legacy key', () => {
    const legacy = JSON.stringify({ battleTimeMode: 'timed', conflictEnabled: false, conflictTargeting: 'hunt-leader', battleDifficulty: 'family' });
    const store = storage({ [MATCH_OPTION_SELECTIONS_STORAGE_KEY]: legacy });
    const battle = loadBattleSetup('battle', store);
    expect(battle.options).toMatchObject({ battleTimeMode: 'timed', conflictEnabled: false, conflictTargeting: 'hunt-leader', battleDifficulty: 'family' });
    expect(loadBattleSetup('team-battle', store).options.conflictTargeting).toBe('all-opponents');
    saveMatchSetup('battle', battle, ['random', 'random', 'random', 'random'], store);
    expect(store.getItem(MATCH_OPTION_SELECTIONS_STORAGE_KEY)).toBe(legacy);
    store.setItem(MATCH_SETUP_STORAGE_KEY, JSON.stringify({ profiles: { battle: { options: { battleDifficulty: 'sport', battleTimeMode: 'broken', conflictEnabled: null } } } }));
    expect(loadBattleSetup('battle', store).options).toMatchObject({ battleTimeMode: 'timed', conflictEnabled: false, battleDifficulty: 'sport' });
  });
  it('validates fields independently and tolerates malformed or unavailable storage', () => {
    const store = storage({ [MATCH_SETUP_STORAGE_KEY]: JSON.stringify({ profiles: { battle: { durationMinutes: 11, options: { battleDifficulty: 'sport', battleTimeMode: 'broken' } } }, tileStyles: ['classic', 'bogus', null, 'random'] }) });
    expect(loadBattleSetup('battle', store)).toMatchObject({ durationMinutes: 5, options: { battleDifficulty: 'sport', battleTimeMode: 'until-victory' } });
    expect(loadSetupTileStyles(store)).toEqual(['classic', 'random', 'random', 'random']);
    expect(loadBattleSetup('battle', storage({ [MATCH_SETUP_STORAGE_KEY]: '{' })).options.battleTimeMode).toBe('until-victory');
    const denied = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); } };
    const fallback = loadBattleSetup('battle', denied);
    expect(() => saveMatchSetup('battle', fallback, ['random', 'random', 'random', 'random'], denied)).not.toThrow();
  });
});
