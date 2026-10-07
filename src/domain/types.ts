import type { GameTuning } from './gameTuning';

export const BOARD_WIDTH = 10;
export const VISIBLE_HEIGHT = 20;
export const HIDDEN_ROWS = 2;
export const BOARD_HEIGHT = VISIBLE_HEIGHT + HIDDEN_ROWS;

export type TetrominoKind = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';
export type SettledKind = TetrominoKind | 'anomaly' | 'garbage';
export type Rotation = 0 | 1 | 2 | 3;
export type Cell = SettledKind | null;
export type Grid = Cell[][];

export interface Position {
  x: number;
  y: number;
}

export interface PieceDefinition {
  id: string;
  source: 'classic' | 'anomaly';
  rotations: Position[][];
  settledKind: Exclude<SettledKind, 'garbage'>;
  classicKind?: TetrominoKind;
}

export interface ActivePiece extends Position {
  definition: PieceDefinition;
  rotation: Rotation;
}

export type AiDifficulty = 'easy' | 'medium' | 'hard' | 'expert';
export type KeyboardController = 'human-1' | 'human-2';
export type MobileController = 'mobile-touch';
export type GamepadController = `gamepad-${number}`;
export type ManualController = KeyboardController | GamepadController | MobileController;
export type ControllerType = ManualController | 'ai';

export function isManualController(controller: ControllerType): controller is ManualController {
  return controller !== 'ai';
}

export function isGamepadController(controller: ControllerType): controller is GamepadController {
  return controller.startsWith('gamepad-');
}

export function gamepadIndexForController(controller: GamepadController): number {
  return Number(controller.slice('gamepad-'.length));
}
export type TileStyle = 'classic' | 'construction-bricks' | 'pixel-adventure' | 'stone-fortress' | 'marmalade' | 'forest-mosaic' | 'sea-crystals';
export type TileStyleSelection = TileStyle | 'random';
export type BattleDifficulty = 'family' | 'normal' | 'sport';
export type SoftDropPreset = 'slow' | 'fast' | 'very-fast';
export type PressurePreset = 'fixed' | 'automatic' | 'extended';
export type MatchVariant = 'free-for-all' | 'teams';
export type BattleTimeMode = 'timed' | 'until-victory';
export type ConflictTargeting = 'all-opponents' | 'hunt-leader';
export type TeamId = 'team-1' | 'team-2';

export interface MatchOptionSelections {
  battleTimeMode: BattleTimeMode;
  battleDifficulty: BattleDifficulty;
  softDrop: SoftDropPreset;
  pressure: PressurePreset;
  conflictEnabled: boolean;
  matchVariant: MatchVariant;
  conflictTargeting: ConflictTargeting;
}

export interface ResolvedMatchOptions extends MatchOptionSelections {
  startingGravityMs: number;
  accelerationPercent: number;
  piecesPerLevel: number;
  softDropIntervalMs: number;
  tuning: Readonly<GameTuning> | null;
}

export interface ParticipantConfig {
  id: string;
  label: string;
  controller: ControllerType;
  controllerLabel?: string;
  teamId?: TeamId;
  difficulty?: AiDifficulty;
  tileStyle?: TileStyleSelection;
}

export interface BoardState {
  grid: Grid;
  active: ActivePiece | null;
  nextPiece: PieceDefinition;
  regularPieceIndex: number;
  spawnSerial: number;
  staticRenderRevision: number;
  pendingAnomalies: PieceDefinition[];
  gravityElapsedMs: number;
  softDropElapsedMs: number;
  lockElapsedMs: number;
  lockResets: number;
  preparationRemainingMs: number;
  preparationElapsedMs: number;
  maneuverRemainingMs: number;
  maneuverSpentMs: number;
  maneuverCancelled: boolean;
  clearFlashMs: number;
  softDrop: boolean;
  alive: boolean;
}

export interface ParticipantState {
  config: ParticipantConfig;
  resolvedTileStyle: TileStyle;
  board: BoardState;
  survivalMs: number;
  eliminatedAtMs: number | null;
  placement: number | null;
  score: number;
  placedPieces: number;
  gravityLevel: number;
  gravityIntervalMs: number;
  levelUpEvent: LevelUpEventState | null;
  lineClearStreak: number;
  shieldCharge: 0 | 1;
  shieldCount: number;
  shieldReady: boolean;
}

export type MatchPhase = 'countdown' | 'playing' | 'paused' | 'results';
export type PauseReason = 'manual' | 'hidden';
export type MatchEndReason = 'survival' | 'timeout' | 'simultaneous-elimination' | null;

export type GlobalEventKind = 'level-up' | 'final-push';

export interface GlobalEventHoldState {
  kind: GlobalEventKind;
  remainingMs: number;
  durationMs: number;
  level?: number;
}

export interface LevelUpEventState {
  serial: number;
  level: number;
  anomalyId: string;
  pulseMs: number;
}

/** Authoritative shared arrival; unfinished pieces remain frozen until removal. */
export interface AnomalyTransitionState {
  serial: number;
  phase: 'clearing' | 'burning';
  remainingMs: number;
  durationMs: number;
  levels: number[];
  targets: { participantId: string; piece: ActivePiece }[];
}

export interface LockEventState {
  participantId: string;
  lines: number;
  source: PieceDefinition['source'];
}

export interface ConflictSenderState {
  participantId: string;
  rows: number;
  recipientIds: string[];
}

export interface ConflictBatchState {
  serial: number;
  remainingWarningMs: number;
  senders: ConflictSenderState[];
  incomingRows: Record<string, number>;
  defendedRecipientIds?: string[];
}

/** One count-independent visual shield sequence; residual impacts retain their ordinary rule. */
export interface ShieldPresentationState {
  serial: number;
  participantId: string;
  remainingMs: number;
  durationMs: number;
  absorbedRows: number;
  remainingRows: number;
  deferredImpacts: { senders?: ConflictSenderState[]; reason: 'conflict' | 'pressure'; rows: number }[];
}

export interface ConflictImpactEventState {
  serial: number;
  incomingRows: Record<string, number>;
  maxRows: number;
  pulseMs: number;
  defendedRecipientIds?: string[];
  shieldedRecipientIds?: string[];
  senders?: ConflictSenderState[];
}

export interface CleanupEventState {
  serial: number;
  participantId: string;
  rows: number;
  pulseMs: number;
  amplified?: boolean;
}

export interface AnomalyBurnEventState {
  serial: number;
  participantId: string;
  rows: Cell[][];
  pulseMs: number;
}

export interface ClearPresentationState {
  serial: number;
  participantId: string;
  lines: number;
  phase: 'highlight' | 'fall';
  remainingMs: number;
  durationMs: number;
  sourceGrid: Grid;
  removedRows: number[];
  rows: { fromY: number; toY: number; cells: Cell[] }[];
  boardRevision: number;
}

export interface ClearImpactEventState {
  serial: number;
  participantId: string;
  lines: number;
}

export interface ClearStreakEventState {
  serial: number;
  participantId: string;
  multiplier: 2 | 3;
  pulseMs: number;
}

export interface ShieldInventoryEventState {
  serial: number;
  participantId: string;
  kind: 'gain' | 'burn';
  reason: 'clear' | 'pressure' | 'conflict';
  firstSlot: number;
  count: number;
  pulseMs: number;
}

export interface ShieldChargeEventState {
  serial: number;
  participantId: string;
  kind: 'half' | 'full';
  pulseMs: number;
}

export interface MatchState {
  seed: number;
  phase: MatchPhase;
  pauseReasons: PauseReason[];
  countdownMs: number;
  roundStartPulseMs: number;
  elapsedMs: number;
  durationMs: number;
  isSurvival: boolean;
  isSoloSurvival: boolean;
  remainingMs: number;
  gravityLevel: number;
  gravityIntervalMs: number;
  options: ResolvedMatchOptions;
  maxPlacedPieces: number;
  pressureStartMs: number;
  nextPressureAtMs: number;
  pressureRows: number;
  pressurePulseMs: number;
  finalPushActive: boolean;
  finalPushSerial: number;
  finalPushPulseMs: number;
  globalEventHold: GlobalEventHoldState | null;
  levelUpEvent: LevelUpEventState | null;
  anomalyTransition: AnomalyTransitionState | null;
  anomalyTransitionSerial: number;
  anomalyArrivalSerial: number;
  lockEvents: LockEventState[];
  pendingConflict: ConflictBatchState | null;
  conflictImpactEvent: ConflictImpactEventState | null;
  cleanupSerial: number;
  cleanupEvents: CleanupEventState[];
  anomalyBurnSerial: number;
  anomalyBurnEvents: AnomalyBurnEventState[];
  clearPresentationSerial: number;
  clearPresentations: ClearPresentationState[];
  clearImpactSerial: number;
  clearImpactEvents: ClearImpactEventState[];
  clearStreakEvents: ClearStreakEventState[];
  shieldPresentationSerial: number;
  shieldPresentations: ShieldPresentationState[];
  shieldInventorySerial: number;
  shieldInventoryEvents: ShieldInventoryEventState[];
  shieldChargeSerial: number;
  shieldChargeEvents: ShieldChargeEventState[];
  participants: ParticipantState[];
  winnerIds: string[];
  endReason: MatchEndReason;
}

export type GameAction =
  | 'move-left'
  | 'move-right'
  | 'move-down'
  | 'rotate-clockwise'
  | 'soft-drop-on'
  | 'soft-drop-off';

export type ActionsByParticipant = ReadonlyMap<string, readonly GameAction[]>;
