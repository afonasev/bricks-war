import { DEFAULT_TILE_STYLE_SELECTION } from '../domain/tileStyles';
import type { TileStyleSelection } from '../domain/types';
import { normalizePlayerName } from './playerNamePersistence';

export const SURVIVAL_PROFILE_KEY = 'bricks-war:survival-profile:v1';

export interface SurvivalProfile {
  name: string;
  controller: 'human-1' | 'human-2';
  tileStyle: TileStyleSelection;
}

const defaults = (): SurvivalProfile => ({ name: 'Игрок 1', controller: 'human-1', tileStyle: DEFAULT_TILE_STYLE_SELECTION });
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
function browserStorage(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function loadSurvivalProfile(storage: Pick<StorageLike, 'getItem'> | null = browserStorage()): SurvivalProfile {
  if (!storage) return defaults();
  try {
    const value = JSON.parse(storage.getItem(SURVIVAL_PROFILE_KEY) ?? 'null') as Partial<SurvivalProfile> | null;
    if (!value || typeof value !== 'object') return defaults();
    return {
      name: typeof value.name === 'string' ? normalizePlayerName(value.name, 0) : defaults().name,
      controller: value.controller === 'human-2' ? 'human-2' : 'human-1',
      tileStyle: typeof value.tileStyle === 'string' ? value.tileStyle as TileStyleSelection : DEFAULT_TILE_STYLE_SELECTION,
    };
  } catch {
    return defaults();
  }
}

export function saveSurvivalProfile(profile: SurvivalProfile, storage: Pick<StorageLike, 'setItem'> | null = browserStorage()): void {
  try {
    storage?.setItem(SURVIVAL_PROFILE_KEY, JSON.stringify({ ...profile, name: normalizePlayerName(profile.name, 0) }));
  } catch {
    // The current session remains usable when storage is unavailable.
  }
}
