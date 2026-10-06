import { cloneGameTuning, DEFAULT_GAME_TUNING, isGameTuningPayload, type GameTuning } from '../domain/gameTuning';

export const GAME_TUNING_STORAGE_KEY = 'bricks-war:game-tuning:v1';

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem' | 'removeItem'>;

function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadGameTuning(storage: ReadStorage | null = defaultStorage()): GameTuning | null {
  if (!storage) return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(GAME_TUNING_STORAGE_KEY) ?? 'null');
    if (isGameTuningPayload(value)) {
      const tuning = cloneGameTuning(value);
      if (tuning.messages.incomingAttack === 'Атака от {senders} +{rows}') {
        tuning.messages.incomingAttack = DEFAULT_GAME_TUNING.messages.incomingAttack;
      }
      return tuning;
    }
    if (value && typeof value === 'object') {
      const source = value as Record<string, unknown>;
      const legacy = {
        ...source,
        battleDifficulties: source.battleDifficulties ?? {
          ...DEFAULT_GAME_TUNING.battleDifficulties,
          normal: {
            startingGravityMs: Number.isFinite(source.startingGravityMs) ? source.startingGravityMs : DEFAULT_GAME_TUNING.battleDifficulties.normal.startingGravityMs,
            accelerationPercent: Number.isFinite(source.accelerationPercent) ? source.accelerationPercent : DEFAULT_GAME_TUNING.battleDifficulties.normal.accelerationPercent,
            piecesPerLevel: Number.isFinite(source.piecesPerLevel) ? source.piecesPerLevel : DEFAULT_GAME_TUNING.battleDifficulties.normal.piecesPerLevel,
          },
        },
        messages: { ...DEFAULT_GAME_TUNING.messages }, mobileTilt: { ...DEFAULT_GAME_TUNING.mobileTilt },
      };
      return isGameTuningPayload(legacy) ? cloneGameTuning(legacy) : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveGameTuning(tuning: GameTuning, storage: WriteStorage | null = defaultStorage()): boolean {
  if (!storage || !isGameTuningPayload(tuning)) return false;
  try {
    storage.setItem(GAME_TUNING_STORAGE_KEY, JSON.stringify(tuning));
    return true;
  } catch {
    return false;
  }
}

export function resetGameTuning(storage: WriteStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(GAME_TUNING_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
