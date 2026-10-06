import type {
  BattleDifficulty,
  MatchOptionSelections,
  MatchVariant,
  ConflictTargeting,
  PressurePreset,
  ResolvedMatchOptions,
  SoftDropPreset,
} from '../domain/types';
import { DEFAULT_GAME_TUNING, type GameTuning } from '../domain/gameTuning';

export const MIN_GRAVITY_INTERVAL_MS = 100;

export const SOFT_DROP_PRESETS: Readonly<Record<SoftDropPreset, number>> = Object.freeze({
  slow: 150,
  fast: 110,
  'very-fast': 80,
});

export const DEFAULT_MATCH_OPTION_SELECTIONS: Readonly<MatchOptionSelections> = Object.freeze({
  battleTimeMode: 'timed',
  battleDifficulty: 'normal',
  softDrop: 'slow',
  pressure: 'automatic',
  conflictEnabled: true,
  matchVariant: 'free-for-all',
  conflictTargeting: 'all-opponents',
});

export const MATCH_VARIANTS: readonly MatchVariant[] = ['free-for-all', 'teams'];
export const CONFLICT_TARGETING_OPTIONS: readonly ConflictTargeting[] = ['all-opponents', 'hunt-leader'];

export function battleDifficultyProfile(tuning: Readonly<GameTuning> | null, difficulty: BattleDifficulty) {
  return (tuning ?? DEFAULT_GAME_TUNING).battleDifficulties[difficulty];
}

export function resolveMatchOptions(
  selections: Partial<MatchOptionSelections> = {},
  tuning: Readonly<GameTuning> | null = null,
): Readonly<ResolvedMatchOptions> {
  const names: MatchOptionSelections = {
    ...DEFAULT_MATCH_OPTION_SELECTIONS,
    ...selections,
  };
  const profile = battleDifficultyProfile(tuning, names.battleDifficulty);
  return Object.freeze({
    ...names,
    startingGravityMs: profile.startingGravityMs,
    accelerationPercent: profile.accelerationPercent,
    piecesPerLevel: profile.piecesPerLevel,
    softDropIntervalMs: tuning?.softDropIntervalMs ?? SOFT_DROP_PRESETS[names.softDrop],
    tuning,
  });
}

export function gravityIntervalFor(
  level: number,
  options: Pick<ResolvedMatchOptions, 'startingGravityMs' | 'accelerationPercent' | 'tuning'>,
): number {
  const reduction = options.accelerationPercent / 100;
  return Math.max(
    options.tuning?.minimumGravityMs ?? MIN_GRAVITY_INTERVAL_MS,
    options.startingGravityMs * ((1 - reduction) ** Math.max(0, level)),
  );
}

export function pressureDurationMs(durationMs: number, preset: PressurePreset): number {
  const boundedDuration = Math.max(0, durationMs);
  if (preset === 'fixed') return Math.min(boundedDuration, 60_000);
  if (preset === 'extended') return Math.min(boundedDuration, Math.max(90_000, boundedDuration * 0.4));
  return Math.min(boundedDuration, Math.max(60_000, boundedDuration * 0.3));
}

export function pressureStartMs(durationMs: number, preset: PressurePreset): number {
  return Math.max(0, durationMs - pressureDurationMs(durationMs, preset));
}
