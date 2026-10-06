import type { AiDifficulty, BattleDifficulty } from './types';
import tuningValues from '../../config/game-tuning.json';
import { fromEntries } from '../runtime/compat';

export interface AiTuning {
  reactionMs: number;
  dropTapIntervalMs: number | null;
  errorChance: number;
  conflictIntentChance: number;
}

export interface MatchMessageTemplates {
  roundStart: string;
  levelUp: string;
  finalPushTitle: string;
  finalPushHint: string;
  incomingAttack: string;
  attackImpact: string;
  activeDefense: string;
  shieldBlock: string;
}
export interface MobileTiltTuning { horizontalThreshold: number; rotateThreshold: number; dropThreshold: number; deadZone: number; smoothing: number; rotateRearmMs: number; }
export interface BattleDifficultyTuning { startingGravityMs: number; accelerationPercent: number; piecesPerLevel: number; }

export interface GameTuning {
  battleDifficulties: Record<BattleDifficulty, BattleDifficultyTuning>;
  minimumGravityMs: number;
  softDropIntervalMs: number;
  horizontalRepeatDelayMs: number;
  horizontalRepeatIntervalMs: number;
  lockDelayMs: number;
  maxLockResets: number;
  spawnPreparationMs: number;
  spawnRotationExtensionMs: number;
  spawnPreparationMaxMs: number;
  pressurePhasePercent: number;
  pressureIntervalMs: number;
  conflictWarningMs: number;
  messages: MatchMessageTemplates;
  ai: Record<AiDifficulty, AiTuning>;
  mobileTilt: MobileTiltTuning;
}

const SCALAR_TUNING_KEYS: ReadonlyArray<Exclude<keyof GameTuning, 'ai' | 'messages' | 'mobileTilt' | 'battleDifficulties'>> = [
  'minimumGravityMs', 'softDropIntervalMs',
  'horizontalRepeatDelayMs', 'horizontalRepeatIntervalMs', 'lockDelayMs', 'maxLockResets',
  'spawnPreparationMs', 'spawnRotationExtensionMs', 'spawnPreparationMaxMs',
  'pressurePhasePercent', 'pressureIntervalMs', 'conflictWarningMs',
];
const AI_DIFFICULTIES: readonly AiDifficulty[] = ['easy', 'medium', 'hard', 'expert'];
export const BATTLE_DIFFICULTIES: readonly BattleDifficulty[] = ['family', 'normal', 'sport'];

export const DEFAULT_GAME_TUNING: Readonly<GameTuning> = Object.freeze(tuningValues as GameTuning);
export const MESSAGE_TEMPLATE_KEYS: ReadonlyArray<keyof MatchMessageTemplates> = [
  'roundStart', 'levelUp', 'finalPushTitle', 'finalPushHint', 'incomingAttack', 'attackImpact', 'activeDefense', 'shieldBlock',
];

export function cloneGameTuning(source: Readonly<GameTuning> = DEFAULT_GAME_TUNING): GameTuning {
  return {
    ...source,
    battleDifficulties: fromEntries(BATTLE_DIFFICULTIES.map((difficulty) => [difficulty, { ...source.battleDifficulties[difficulty] }])) as Record<BattleDifficulty, BattleDifficultyTuning>,
    messages: { ...source.messages },
    mobileTilt: { ...source.mobileTilt },
    ai: fromEntries(Object.entries(source.ai).map(([key, value]) => [key, { ...value }])) as Record<AiDifficulty, AiTuning>,
  };
}

/** Validates the complete payload shared by device-local and release-file saves. */
export function isGameTuningPayload(value: unknown): value is GameTuning {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  if (!SCALAR_TUNING_KEYS.every((key) => Number.isFinite(payload[key]))) return false;
  if ((payload.spawnPreparationMs as number) < 0
    || (payload.spawnRotationExtensionMs as number) < 0
    || (payload.spawnPreparationMaxMs as number) < (payload.spawnPreparationMs as number)) return false;
  const battleDifficulties = payload.battleDifficulties as Record<string, unknown> | undefined;
  if (!battleDifficulties || !BATTLE_DIFFICULTIES.every((difficulty) => {
    const profile = battleDifficulties[difficulty] as Record<string, unknown> | undefined;
    return profile && Number.isFinite(profile.startingGravityMs) && Number.isFinite(profile.accelerationPercent) && Number.isFinite(profile.piecesPerLevel);
  })) return false;
  if (!payload.messages || typeof payload.messages !== 'object') return false;
  const messages = payload.messages as Record<string, unknown>;
  if (!MESSAGE_TEMPLATE_KEYS.every((key) => typeof messages[key] === 'string')) return false;
  if (!payload.ai || typeof payload.ai !== 'object') return false;
  const ai = payload.ai as Record<string, unknown>;
  if (!AI_DIFFICULTIES.every((difficulty) => {
    const profile = ai[difficulty];
    if (!profile || typeof profile !== 'object') return false;
    const fields = profile as Record<string, unknown>;
    return Number.isFinite(fields.reactionMs)
      && (fields.dropTapIntervalMs === null || Number.isFinite(fields.dropTapIntervalMs))
      && Number.isFinite(fields.errorChance)
      && Number.isFinite(fields.conflictIntentChance);
  })) return false;
  const tilt = payload.mobileTilt as Record<string, unknown> | undefined;
  if (!tilt) return false;
  return ['horizontalThreshold', 'rotateThreshold', 'dropThreshold', 'deadZone', 'smoothing', 'rotateRearmMs'].every((key) => Number.isFinite(tilt[key]));
}

export function releaseTuningSaveEnabled(location: Pick<Location, 'hostname'> = window.location): boolean {
  const local = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  return local;
}

/** Keeps the current debug-laboratory entry point working while release-save access is migrated separately. */
export function debugModeEnabled(location: Pick<Location, 'hostname' | 'search'> = window.location): boolean {
  const local = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  return local && new URLSearchParams(location.search).get('debug') === '1';
}
