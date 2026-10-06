import type { MatchOptionSelections, TileStyleSelection } from '../domain/types';
import { isTileStyle } from '../domain/tileStyles';
import { DEFAULT_MATCH_OPTION_SELECTIONS } from '../simulation/matchOptions';
import { DEFAULT_DURATION_MINUTES } from '../simulation/match';
import { loadMatchOptionSelections, MATCH_OPTION_SELECTIONS_STORAGE_KEY } from './matchOptionsPersistence';

export const MATCH_SETUP_STORAGE_KEY = 'bricks-war:match-setup:v2';
export type BattleSetupMode = 'battle' | 'team-battle';
export interface BattleSetupPreferences { options: MatchOptionSelections; durationMinutes: number }
type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): Store | null {
  try { return window.localStorage; } catch { return null; }
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function read(key: string, storage: Pick<Store, 'getItem'> | null): Record<string, unknown> {
  try { return record(JSON.parse(storage?.getItem(key) ?? 'null')); } catch { return {}; }
}
export function loadBattleSetup(mode: BattleSetupMode, storage: Pick<Store, 'getItem'> | null = browserStorage()): BattleSetupPreferences {
  const data = record(record(read(MATCH_SETUP_STORAGE_KEY, storage).profiles)[mode]);
  const legacy = read(MATCH_OPTION_SELECTIONS_STORAGE_KEY, storage);
  const defaults: MatchOptionSelections = { ...DEFAULT_MATCH_OPTION_SELECTIONS, battleTimeMode: 'until-victory' };
  const legacyOptions = loadMatchOptionSelections({ getItem: () => JSON.stringify(legacy) }, defaults);
  const options = loadMatchOptionSelections({ getItem: () => JSON.stringify(record(data.options)) }, legacyOptions);
  options.matchVariant = mode === 'team-battle' ? 'teams' : 'free-for-all';
  if (mode === 'team-battle') options.conflictTargeting = 'all-opponents';
  const minutes = data.durationMinutes;
  return { options, durationMinutes: typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 2 && minutes <= 10 ? minutes : DEFAULT_DURATION_MINUTES };
}
export function loadSetupTileStyles(storage: Pick<Store, 'getItem'> | null = browserStorage()): TileStyleSelection[] {
  const styles = read(MATCH_SETUP_STORAGE_KEY, storage).tileStyles;
  return Array.from({ length: 4 }, (_, index) => {
    const value: unknown = Array.isArray(styles) ? styles[index] : null;
    return typeof value === 'string' && (value === 'random' || isTileStyle(value)) ? value : 'random';
  });
}
export function saveMatchSetup(mode: BattleSetupMode | 'survival', preferences: BattleSetupPreferences, tileStyles: readonly TileStyleSelection[], storage: Store | null = browserStorage()): void {
  if (!storage) return;
  try {
    const previous = read(MATCH_SETUP_STORAGE_KEY, storage);
    const profiles = { ...record(previous.profiles) };
    if (mode !== 'survival') profiles[mode] = preferences;
    storage.setItem(MATCH_SETUP_STORAGE_KEY, JSON.stringify({ profiles, tileStyles }));
  } catch { /* Current-page choices remain usable when storage is unavailable. */ }
}
