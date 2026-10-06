import type {
  BattleDifficulty,
  ConflictTargeting,
  MatchOptionSelections,
  MatchVariant,
  PressurePreset,
  SoftDropPreset,
} from '../domain/types';
import { DEFAULT_MATCH_OPTION_SELECTIONS } from '../simulation/matchOptions';

export const MATCH_OPTION_SELECTIONS_STORAGE_KEY = 'bricks-war:match-options:v1';

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

const VALID_BATTLE_DIFFICULTY = new Set<BattleDifficulty>(['family', 'normal', 'sport']);
const VALID_SOFT_DROP = new Set<SoftDropPreset>(['slow', 'fast', 'very-fast']);
const VALID_PRESSURE = new Set<PressurePreset>(['fixed', 'automatic', 'extended']);
const VALID_VARIANTS = new Set<MatchVariant>(['free-for-all', 'teams']);
const VALID_TARGETING = new Set<ConflictTargeting>(['all-opponents', 'hunt-leader']);

function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function loadMatchOptionSelections(storage: ReadStorage | null = defaultStorage(), fallback: Readonly<MatchOptionSelections> = DEFAULT_MATCH_OPTION_SELECTIONS): MatchOptionSelections {
  const defaults: MatchOptionSelections = { ...fallback };
  if (!storage) return defaults;
  try {
    const parsed = JSON.parse(storage.getItem(MATCH_OPTION_SELECTIONS_STORAGE_KEY) ?? 'null') as unknown;
    if (!isRecord(parsed)) return defaults;
    return {
      battleTimeMode: parsed.battleTimeMode === 'until-victory' || parsed.battleTimeMode === 'timed' ? parsed.battleTimeMode : defaults.battleTimeMode,
      battleDifficulty: VALID_BATTLE_DIFFICULTY.has(parsed.battleDifficulty as BattleDifficulty) ? parsed.battleDifficulty as BattleDifficulty : defaults.battleDifficulty,
      softDrop: VALID_SOFT_DROP.has(parsed.softDrop as SoftDropPreset) ? parsed.softDrop as SoftDropPreset : defaults.softDrop,
      pressure: VALID_PRESSURE.has(parsed.pressure as PressurePreset) ? parsed.pressure as PressurePreset : defaults.pressure,
      conflictEnabled: typeof parsed.conflictEnabled === 'boolean' ? parsed.conflictEnabled : defaults.conflictEnabled,
      matchVariant: VALID_VARIANTS.has(parsed.matchVariant as MatchVariant) ? parsed.matchVariant as MatchVariant : defaults.matchVariant,
      conflictTargeting: VALID_TARGETING.has(parsed.conflictTargeting as ConflictTargeting) ? parsed.conflictTargeting as ConflictTargeting : defaults.conflictTargeting,
    };
  } catch {
    return defaults;
  }
}

export function saveMatchOptionSelections(
  selections: MatchOptionSelections,
  storage: WriteStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(MATCH_OPTION_SELECTIONS_STORAGE_KEY, JSON.stringify(selections));
  } catch {
    // Storage can be unavailable in privacy modes; the selected options still apply this match.
  }
}
