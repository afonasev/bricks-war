import { balancedNetworkTeams } from '../network/rules';
import type {
  ActionsByParticipant,
  GameAction,
  GlobalEventKind,
  MatchPhase,
  PauseReason,
  MatchState,
  MatchOptionSelections,
  ParticipantConfig,
  ParticipantState,
  LockEventState,
  ClearPresentationState,
} from '../domain/types';
import { HIDDEN_ROWS, isManualController } from '../domain/types';
import { DEFAULT_GAME_TUNING, type GameTuning } from '../domain/gameTuning';
import { DEFAULT_TILE_STYLE_SELECTION } from '../domain/tileStyles';
import {
  addGrayRows,
  burnBottomRows,
  addRisingFloor,
  canPlace,
  clearCompletedLines,
  createBoard,
  lockPiece,
  removeBottomGrayRows,
  spawnPiece,
  tryMove,
  tryRotateClockwise,
} from './board';
import { generateAnomaly } from './anomaly';
import { conflictTargetIds, scoreLeaderIds, participantTeamId, teamScores } from './competition';
import { PieceSequence } from './random';
import { resolveParticipantTileStyles } from './tileStyles';
import { pieceCells, pieceDefinition } from './tetrominoes';
import { clearFallDurationMs, completedRowIndices, NORMAL_CLEAR_HIGHLIGHT_MS, settlingRows } from './clearPresentation';
import {
  DEFAULT_MATCH_OPTION_SELECTIONS,
  gravityIntervalFor,
  pressureStartMs,
  resolveMatchOptions,
} from './matchOptions';

export const FIXED_STEP_MS = 1000 / 60;
export const COUNTDOWN_MS = 3000;
export const LOCK_DELAY_MS = 500;
export const SOFT_DROP_INTERVAL_MS = 150;
export const MAX_LOCK_RESETS = 15;
export const TOP_MANEUVER_MS = 600;
export const TOP_MANEUVER_BUDGET_MS = 2000;
export const TOP_MANEUVER_ROWS = 4;
export const CLEAR_FLASH_MS = 220;
export const DEFAULT_DURATION_MINUTES = 5;
export const MIN_DURATION_MINUTES = 2;
export const MAX_DURATION_MINUTES = 10;
export const PRESSURE_INTERVAL_MS = 10_000;
export const SOLO_PRESSURE_START_MS = 180_000;
export const SOLO_PRESSURE_INTERVAL_MS = 15_000;
export const SOLO_PRESSURE_MIN_INTERVAL_MS = 5_000;
export const SOLO_PRESSURE_INTERVAL_DECREMENT_MS = 1_000;
export const PRESSURE_PULSE_MS = 650;
export const ROUND_START_PULSE_MS = 1100;
export const LEVEL_UP_PULSE_MS = 1200;
export const ANOMALY_ARRIVAL_BURN_MS = 1000;
export const CONFLICT_WARNING_MS = 3000;
export const CONFLICT_IMPACT_PULSE_MS = 700;
export const MIN_CONFLICT_NOTICE_MS = 2_000;
export const CLEANUP_PULSE_MS = 800;
export const ANOMALY_BURN_PULSE_MS = 1_000;
export const SHIELD_CHARGE_NOTICE_MS = 1_250;
export const FINAL_PUSH_PULSE_MS = 2_000;
export const MAX_REACHABLE_GRAVITY_LEVELS = Math.floor(
  (MAX_DURATION_MINUTES * 60_000) / LOCK_DELAY_MS / 10,
);

export interface ConfigurationError {
  message: string;
}

export function validateParticipants(configs: readonly ParticipantConfig[]): ConfigurationError[] {
  const errors: ConfigurationError[] = [];
  const solo = configs.length === 1 && isManualController(configs[0]!.controller);
  if ((!solo && configs.length < 2) || configs.length > 4) {
    errors.push({ message: 'Нужно выбрать от 2 до 4 участников или одного игрока для выживания.' });
  }
  const humans = configs.filter((config) => isManualController(config.controller));
  if (new Set(humans.map((config) => config.controller)).size !== humans.length) {
    errors.push({ message: 'Каждый контроллер можно назначить только одному игроку.' });
  }
  if (configs.some((config) => config.controller === 'ai' && !config.difficulty)) {
    errors.push({ message: 'Для каждого ИИ нужно выбрать сложность.' });
  }
  return errors;
}

export function validateSurvivalParticipants(configs: readonly ParticipantConfig[]): ConfigurationError[] {
  const errors: ConfigurationError[] = [];
  if (configs.length < 1 || configs.length > 4 || configs.some((config) => !isManualController(config.controller))) {
    errors.push({ message: 'В выживании нужен от 1 до 4 игроков без ИИ.' });
  }
  const humans = configs.filter((config) => isManualController(config.controller));
  if (new Set(humans.map((config) => config.controller)).size !== humans.length) {
    errors.push({ message: 'Каждый контроллер можно назначить только одному игроку.' });
  }
  return errors;
}

export function validateDurationMinutes(durationMinutes: number): ConfigurationError[] {
  return Number.isInteger(durationMinutes)
    && durationMinutes >= MIN_DURATION_MINUTES
    && durationMinutes <= MAX_DURATION_MINUTES
    ? []
    : [{ message: 'Длительность матча должна быть от 2 до 10 минут.' }];
}

export function validateMatchOptions(
  configs: readonly ParticipantConfig[],
  selections: Pick<MatchOptionSelections, 'matchVariant'>,
): ConfigurationError[] {
  return selections.matchVariant === 'teams' && configs.length !== 4
    ? [{ message: 'Для режима 2×2 нужны четыре участника: по двое в каждой команде.' }]
    : [];
}

export function scoreForLines(lines: number): number {
  return [0, 100, 300, 500, 800][lines] ?? 0;
}

export function attackRowsForLines(lines: number): number {
  if (lines >= 4) return 4;
  if (lines === 3) return 3;
  if (lines === 2) return 1;
  return 0;
}

export function nextShieldCharge(
  sequence: number,
  _halfCharge: 0 | 1,
  shieldFull: boolean,
  lines: number,
  source: 'classic' | 'anomaly' = 'classic',
  isSurvival = false,
) {
  const qualifies = source === 'classic' && (isSurvival ? lines >= 1 : lines === 1);
  const lineClearStreak = qualifies ? sequence + 1 : 0;
  return { lineClearStreak, shieldCharge: 0 as const,
    kind: lineClearStreak >= 2 && !shieldFull ? 'full' as const : null };
}

export function gravityIntervalMs(
  level: number,
  selections: Partial<MatchOptionSelections> = DEFAULT_MATCH_OPTION_SELECTIONS,
): number {
  return gravityIntervalFor(level, resolveMatchOptions(selections));
}

interface PendingClear {
  source: LockEventState['source'];
  lines: number;
  nextPiece: ParticipantState['board']['nextPiece'];
  cleanupCapacity: number;
  underAttack: boolean;
  stage: 'playable' | 'burn';
}

export type EncodedMatchState = Omit<MatchState, 'durationMs' | 'remainingMs'> & {
  durationMs: number | null;
  remainingMs: number | null;
};

export function encodeMatchState(state: MatchState): EncodedMatchState {
  return structuredClone({ ...state, durationMs: Number.isFinite(state.durationMs) ? state.durationMs : null,
    remainingMs: Number.isFinite(state.remainingMs) ? state.remainingMs : null });
}

export function decodeMatchState(state: EncodedMatchState): MatchState {
  return structuredClone({ ...state, durationMs: state.durationMs ?? Infinity, remainingMs: state.remainingMs ?? Infinity });
}

export interface EngineCheckpoint {
  version: 4;
  execution: 'local' | 'network';
  state: EncodedMatchState;
  sequence: ReturnType<PieceSequence['checkpoint']>;
  phaseBeforePause: MatchPhase;
  nonAttackLockIds: string[];
  resolvedAnomalyBurnParticipantIds: string[];
  resolvedClearParticipantIds: string[];
  pendingClears: [string, PendingClear][];
  deferredPressureRows: [string, number][];
}

export function validateNetworkSurvivalParticipants(configs: readonly ParticipantConfig[]): ConfigurationError[] {
  return configs.length >= 2 && configs.length <= 8
    && configs.filter((config) => config.controller !== 'ai').length >= 2
    && configs.filter((config) => config.controller === 'ai').length <= 6
    && configs.every((config) => config.controller !== 'ai' || ['easy', 'medium', 'hard', 'expert'].includes(config.difficulty ?? ''))
    && new Set(configs.map((config) => config.id)).size === configs.length
    ? [] : [{ message: 'Сетевое Выживание: минимум два человека, до шести ИИ и восьми разных участников.' }];
}

export class MatchEngine {
  readonly state: MatchState;
  readonly sequence: PieceSequence;
  readonly options;
  private phaseBeforePause: MatchPhase = 'playing';
  private nonAttackLockIds = new Set<string>();
  private resolvedAnomalyBurnParticipantIds = new Set<string>();
  private resolvedClearParticipantIds = new Set<string>();
  private pendingClears = new Map<string, PendingClear>();
  private deferredPressureRows = new Map<string, number>();
  // Exists only inside one synchronous step; checkpoints never capture an unfinished step.
  private stepSpawns = new Map<string, ParticipantState['board']['nextPiece']>();

  constructor(
    configs: readonly ParticipantConfig[],
    seed: number,
    durationMinutes = DEFAULT_DURATION_MINUTES,
    optionSelections: Partial<MatchOptionSelections> = {},
    gameTuning: Readonly<GameTuning> | null = null,
    survival = configs.length === 1,
    readonly execution: 'local' | 'network' = 'local',
  ) {
    const resolvedSelections = resolveMatchOptions(survival ? { ...optionSelections, conflictEnabled: false, battleTimeMode: 'timed' } : optionSelections, gameTuning);
    const errors = [
      ...(execution === 'network' ? validateNetworkSurvivalParticipants(configs) : validateParticipants(configs)),
      ...validateDurationMinutes(durationMinutes),
      ...(execution === 'network' && resolvedSelections.matchVariant === 'teams' ? (balancedNetworkTeams(configs) ? [] : [{message: 'Нужны равные команды 2×2, 3×3 или 4×4.'}]) : validateMatchOptions(configs, resolvedSelections)),
      ...(survival && execution === 'local' ? validateSurvivalParticipants(configs) : []),
    ];
    if (execution === 'network' && survival && resolvedSelections.matchVariant !== 'free-for-all') errors.push({message: 'Выживание не поддерживает команды.'});
    if (errors.length > 0) throw new Error(errors.map((error) => error.message).join(' '));
    this.sequence = new PieceSequence(seed);
    this.options = resolvedSelections;
    const resolvedTileStyles = resolveParticipantTileStyles(configs, seed);
    const isSoloSurvival = survival;
    const unbounded = survival || this.options.battleTimeMode === 'until-victory';
    const durationMs = unbounded ? Infinity : durationMinutes * 60_000;
    const configuredPressureStartMs = gameTuning
      ? durationMs * (1 - (gameTuning.pressurePhasePercent / 100))
      : pressureStartMs(durationMs, this.options.pressure);
    const pressureStart = unbounded ? SOLO_PRESSURE_START_MS : configuredPressureStartMs;
    this.state = {
      seed,
      phase: 'countdown',
      pauseReasons: [],
      countdownMs: COUNTDOWN_MS,
      roundStartPulseMs: 0,
      elapsedMs: 0,
      durationMs,
      isSurvival: survival,
      isSoloSurvival,
      remainingMs: durationMs,
      gravityLevel: 0,
      gravityIntervalMs: gravityIntervalFor(0, this.options),
      options: { ...this.options },
      maxPlacedPieces: 0,
      pressureStartMs: pressureStart,
      nextPressureAtMs: unbounded ? pressureStart : pressureStart + (gameTuning?.pressureIntervalMs ?? PRESSURE_INTERVAL_MS),
      pressureRows: 0,
      pressurePulseMs: 0,
      finalPushActive: false,
      finalPushSerial: 0,
      finalPushPulseMs: 0,
      globalEventHold: null,
      levelUpEvent: null,
      anomalyTransition: null,
      anomalyTransitionSerial: 0,
      anomalyArrivalSerial: 0,
      lockEvents: [],
      pendingConflict: null,
      conflictImpactEvent: null,
      cleanupSerial: 0,
      cleanupEvents: [],
      anomalyBurnSerial: 0,
      anomalyBurnEvents: [],
      clearPresentationSerial: 0,
      clearPresentations: [],
      clearImpactSerial: 0,
      clearImpactEvents: [],
      clearStreakEvents: [],
      shieldChargeSerial: 0,
      shieldChargeEvents: [],
      shieldInventorySerial: 0,
      shieldInventoryEvents: [],
      participants: configs.map((config) => ({
        config: { ...config, tileStyle: config.tileStyle ?? DEFAULT_TILE_STYLE_SELECTION },
        resolvedTileStyle: resolvedTileStyles.get(config.id) ?? 'classic',
        board: createBoard(this.sequence.at(0), this.sequence.at(1), this.spawnPreparationMs()),
        survivalMs: 0,
        eliminatedAtMs: null,
        placement: null,
        score: 0,
        placedPieces: 0,
        gravityLevel: 0,
        gravityIntervalMs: gravityIntervalFor(0, this.options),
        levelUpEvent: null,
        lineClearStreak: 0,
        shieldCharge: 0,
        shieldCount: 0,
        shieldReady: false,
      })),
      winnerIds: [],
      endReason: null,
    };
  }

  checkpoint(): EngineCheckpoint {
    return structuredClone({ version: 4, execution: this.execution, state: encodeMatchState(this.state),
      sequence: this.sequence.checkpoint(), phaseBeforePause: this.phaseBeforePause,
      nonAttackLockIds: [...this.nonAttackLockIds], resolvedAnomalyBurnParticipantIds: [...this.resolvedAnomalyBurnParticipantIds],
      resolvedClearParticipantIds: [...this.resolvedClearParticipantIds], pendingClears: [...this.pendingClears],
      deferredPressureRows: [...this.deferredPressureRows] });
  }

  static restore(checkpoint: EngineCheckpoint): MatchEngine {
    if (checkpoint.version !== 4) throw new Error('Unsupported checkpoint version');
    const state = decodeMatchState(checkpoint.state);
    const engine = new MatchEngine(state.participants.map((p) => p.config), state.seed,
      Number.isFinite(state.durationMs) ? state.durationMs / 60_000 : DEFAULT_DURATION_MINUTES,
      state.options, state.options.tuning, state.isSurvival, checkpoint.execution);
    Object.assign(engine.state, state);
    engine.sequence.restore(checkpoint.sequence);
    engine.phaseBeforePause = checkpoint.phaseBeforePause;
    engine.nonAttackLockIds = new Set(checkpoint.nonAttackLockIds);
    engine.resolvedAnomalyBurnParticipantIds = new Set(checkpoint.resolvedAnomalyBurnParticipantIds);
    engine.resolvedClearParticipantIds = new Set(checkpoint.resolvedClearParticipantIds);
    engine.pendingClears = new Map(structuredClone(checkpoint.pendingClears));
    engine.deferredPressureRows = new Map(checkpoint.deferredPressureRows);
    return engine;
  }

  eliminate(participantId: string): void {
    const participant = this.state.participants.find((p) => p.config.id === participantId);
    if (!participant?.board.alive || this.state.phase === 'results') return;
    participant.board.alive = false;
    participant.board.softDrop = false;
    participant.eliminatedAtMs = this.state.elapsedMs;
    participant.survivalMs = this.state.elapsedMs;
    this.pendingClears.delete(participantId);
    this.deferredPressureRows.delete(participantId);
    this.state.clearPresentations = this.state.clearPresentations.filter((p) => p.participantId !== participantId);
    this.resolveOutcomeWhenReady();
  }

  step(deltaMs: number, actions: ActionsByParticipant = new Map()): void {
    if (deltaMs <= 0 || this.state.phase === 'paused' || this.state.phase === 'results') return;
    if (this.state.phase === 'countdown') {
      this.state.countdownMs = Math.max(0, this.state.countdownMs - deltaMs);
      if (this.state.countdownMs === 0) {
        this.state.phase = 'playing';
        this.state.roundStartPulseMs = ROUND_START_PULSE_MS;
      }
      return;
    }

    if (this.state.anomalyTransition) {
      this.advanceAnomalyTransition(deltaMs);
      return;
    }

    if (this.state.globalEventHold) {
      this.advanceGlobalEventHold(deltaMs);
      return;
    }

    if (!this.state.isSurvival && this.state.elapsedMs >= this.state.durationMs) {
      this.nonAttackLockIds.clear();
      this.state.lockEvents = this.tickPresentation(deltaMs).sort((a, b) => a.participantId.localeCompare(b.participantId));
      this.collectConflictAttacks(this.state.lockEvents);
      for (const [id, next] of this.stepSpawns) {
        const p = this.state.participants.find((p) => p.config.id === id);
        if (p?.board.alive) this.spawnAfterLock(p, next);
      }
      this.stepSpawns.clear();
      this.advancePendingConflict(deltaMs);
      this.updateSurvivalTimes();
      this.resolveOutcomeWhenReady();
      return;
    }

    this.stepSpawns.clear();
    const previousElapsedMs = this.state.elapsedMs;
    this.state.elapsedMs = this.state.isSurvival ? this.state.elapsedMs + deltaMs : Math.min(this.state.durationMs, this.state.elapsedMs + deltaMs);
    this.state.remainingMs = Math.max(0, this.state.durationMs - this.state.elapsedMs);
    const activeDeltaMs = this.state.elapsedMs - previousElapsedMs;
    this.resolvedAnomalyBurnParticipantIds.clear();
    this.resolvedClearParticipantIds.clear();
    if (!this.state.finalPushActive && previousElapsedMs < this.state.pressureStartMs && this.state.elapsedMs >= this.state.pressureStartMs) {
      this.state.finalPushActive = true;
      this.state.finalPushSerial += 1;
      this.state.finalPushPulseMs = FINAL_PUSH_PULSE_MS + activeDeltaMs;
      this.startGlobalEventHold('final-push', FINAL_PUSH_PULSE_MS);
    }
    this.nonAttackLockIds.clear();
    const completedLocks = this.tickPresentation(activeDeltaMs);
    this.advancePendingConflict(activeDeltaMs);

    const previousGravityLevel = this.state.gravityLevel;
    const lockEvents: LockEventState[] = [...completedLocks];

    for (const participant of this.state.participants) {
      if (!participant.board.alive) continue;
      if (this.pendingClears.has(participant.config.id) || this.resolvedClearParticipantIds.has(participant.config.id) || this.resolvedAnomalyBurnParticipantIds.has(participant.config.id)) continue;
      participant.board.clearFlashMs = Math.max(0, participant.board.clearFlashMs - activeDeltaMs);
      this.applyActions(participant, actions.get(participant.config.id) ?? []);
      const lockEvent = this.advanceBoard(participant, activeDeltaMs);
      if (lockEvent) lockEvents.push(lockEvent);
    }
    this.state.lockEvents = lockEvents.sort((a, b) => a.participantId.localeCompare(b.participantId));
    this.collectConflictAttacks(this.state.lockEvents);

    this.state.maxPlacedPieces = Math.max(
      this.state.maxPlacedPieces,
      ...this.state.participants.map((participant) => participant.placedPieces
        + (!this.state.isSurvival && this.pendingClears.get(participant.config.id)?.stage === 'playable' ? 1 : 0)),
    );
    const nextGravityLevel = Math.floor(this.state.maxPlacedPieces / this.options.piecesPerLevel);
    // Preserve the ordinary spawn-before-pressure order outside a shared level transition.
    if (nextGravityLevel <= previousGravityLevel) this.flushStepSpawns();

    while (
      (this.state.isSurvival || this.state.nextPressureAtMs < this.state.durationMs)
      && this.state.nextPressureAtMs <= this.state.elapsedMs
    ) {
      for (const participant of this.state.participants) {
        if (participant.board.alive && !this.hasPendingAnomalyBurn(participant.config.id) && !this.resolvedAnomalyBurnParticipantIds.has(participant.config.id)) {
          if (this.absorbShieldRows(participant, 1, 'pressure') === 0) continue;
          if (this.pendingClears.has(participant.config.id)) {
            this.deferredPressureRows.set(participant.config.id, (this.deferredPressureRows.get(participant.config.id) ?? 0) + 1);
          } else addRisingFloor(participant.board);
        }
      }
      this.state.pressureRows += 1;
      this.state.pressurePulseMs = PRESSURE_PULSE_MS;
      const pressureIntervalMs = !Number.isFinite(this.state.durationMs)
        ? Math.max(SOLO_PRESSURE_MIN_INTERVAL_MS, SOLO_PRESSURE_INTERVAL_MS
          - (this.state.pressureRows - 1) * SOLO_PRESSURE_INTERVAL_DECREMENT_MS)
        : this.options.tuning?.pressureIntervalMs ?? PRESSURE_INTERVAL_MS;
      this.state.nextPressureAtMs += pressureIntervalMs;
    }

    if (this.state.isSurvival) {
      for (const participant of this.state.participants) {
        const level = Math.floor(participant.placedPieces / this.options.piecesPerLevel);
        if (level <= participant.gravityLevel) continue;
        for (let nextLevel = participant.gravityLevel + 1; nextLevel <= level; nextLevel += 1) this.deliverLevelAnomaly(nextLevel, [participant]);
        participant.gravityLevel = level;
        participant.gravityIntervalMs = gravityIntervalFor(level, this.options);
      }
    } else {
      for (let level = previousGravityLevel + 1; level <= nextGravityLevel; level += 1) this.deliverLevelAnomaly(level);
      for (const participant of this.state.participants) {
        participant.gravityLevel = nextGravityLevel;
        participant.gravityIntervalMs = gravityIntervalFor(nextGravityLevel, this.options);
      }
    }
    this.state.gravityLevel = nextGravityLevel;
    this.state.gravityIntervalMs = gravityIntervalFor(nextGravityLevel, this.options);

    if (!this.state.anomalyTransition) this.flushStepSpawns();
    this.stepSpawns.clear();
    this.updateSurvivalTimes();
    this.resolveOutcomeWhenReady();
  }

  pause(reason: PauseReason = 'manual'): void {
    if (this.state.phase === 'results' || this.state.pauseReasons.includes(reason)) return;
    if (this.state.pauseReasons.length === 0) {
      this.phaseBeforePause = this.state.phase;
      this.state.phase = 'paused';
    }
    this.state.pauseReasons = [...this.state.pauseReasons, reason];
  }

  resume(reason: PauseReason = 'manual'): void {
    if (!this.state.pauseReasons.includes(reason)) return;
    this.state.pauseReasons = this.state.pauseReasons.filter((activeReason) => activeReason !== reason);
    if (this.state.phase === 'paused' && this.state.pauseReasons.length === 0) {
      this.state.phase = this.phaseBeforePause;
    }
  }

  toggleManualPause(): boolean {
    if (this.state.phase === 'results') return false;
    if (this.state.pauseReasons.includes('manual')) this.resume('manual');
    else this.pause('manual');
    return true;
  }

  acceptsGameplayInput(): boolean {
    return this.state.phase === 'playing' && this.state.globalEventHold === null && this.state.anomalyTransition === null;
  }

  private startGlobalEventHold(kind: GlobalEventKind, durationMs: number, level?: number): void {
    const current = this.state.globalEventHold;
    const priority = kind === 'final-push' ? 2 : 1;
    const currentPriority = current?.kind === 'final-push' ? 2 : current ? 1 : 0;
    this.state.globalEventHold = {
      kind: priority >= currentPriority ? kind : current!.kind,
      durationMs: Math.max(current?.durationMs ?? 0, durationMs),
      remainingMs: Math.max(current?.remainingMs ?? 0, durationMs),
      level: level ?? current?.level,
    };
    for (const participant of this.state.participants) {
      participant.board.softDrop = false;
      participant.board.softDropElapsedMs = 0;
    }
  }

  private advanceGlobalEventHold(deltaMs: number): void {
    const hold = this.state.globalEventHold;
    if (!hold) return;
    hold.remainingMs = Math.max(0, hold.remainingMs - deltaMs);
    this.state.finalPushPulseMs = Math.max(0, this.state.finalPushPulseMs - deltaMs);
    if (this.state.levelUpEvent) {
      this.state.levelUpEvent.pulseMs = Math.max(0, this.state.levelUpEvent.pulseMs - deltaMs);
    }
    for (const participant of this.state.participants) {
      if (participant.levelUpEvent) participant.levelUpEvent.pulseMs = Math.max(0, participant.levelUpEvent.pulseMs - deltaMs);
    }
    if (hold.remainingMs > 0) return;
    this.state.finalPushPulseMs = 0;
    if (this.state.levelUpEvent) this.state.levelUpEvent.pulseMs = 0;
    this.state.globalEventHold = null;
  }

  private applyActions(participant: ParticipantState, actions: readonly GameAction[]): void {
    const board = participant.board;
    for (const action of actions) {
      let adjusted = false;
      if (action === 'move-left') adjusted = tryMove(board, -1, 0);
      if (action === 'move-right') adjusted = tryMove(board, 1, 0);
      if (action === 'move-down') {
        this.endPreparation(board);
        this.cancelManeuver(board);
        adjusted = tryMove(board, 0, 1);
      }
      if (action === 'rotate-clockwise') {
        this.extendPreparation(board);
        adjusted = tryRotateClockwise(board);
      }
      if (adjusted && (action === 'move-left' || action === 'move-right' || action === 'rotate-clockwise')
        && !board.maneuverCancelled && this.isTopGrounded(board)) {
        board.maneuverRemainingMs = Math.min(TOP_MANEUVER_MS, Math.max(0, TOP_MANEUVER_BUDGET_MS - board.maneuverSpentMs));
      }
      if (adjusted && board.lockElapsedMs > 0 && board.lockResets < (this.options.tuning?.maxLockResets ?? MAX_LOCK_RESETS)) {
        board.lockElapsedMs = 0;
        board.lockResets += 1;
      }
      if (action === 'soft-drop-on') {
        this.endPreparation(board);
        this.cancelManeuver(board);
        board.softDrop = true;
      }
      if (action === 'soft-drop-off') board.softDrop = false;
    }
  }

  private advanceBoard(participant: ParticipantState, deltaMs: number): LockEventState | null {
    const board = participant.board;
    if (this.hasPendingAnomalyBurn(participant.config.id)) return null;
    // Both protections consume the same simulation interval; they never stack.
    let maneuverConsumed = 0;
    if (board.maneuverRemainingMs > 0 && !board.maneuverCancelled && this.isTopGrounded(board)) {
      maneuverConsumed = Math.min(deltaMs, board.maneuverRemainingMs, Math.max(0, TOP_MANEUVER_BUDGET_MS - board.maneuverSpentMs));
      board.maneuverRemainingMs -= maneuverConsumed;
      board.maneuverSpentMs += maneuverConsumed;
    } else {
      board.maneuverRemainingMs = 0;
    }
    let preparationConsumed = 0;
    // A non-zero lock timer is a deliberately staged board state used by
    // deterministic simulation fixtures. Normal play cannot accumulate it
    // during preparation, so it safely denotes an already-prepared piece.
    if (board.preparationRemainingMs > 0 && board.lockElapsedMs === 0) {
      const consumed = Math.min(deltaMs, board.preparationRemainingMs);
      preparationConsumed = consumed;
      board.preparationRemainingMs -= consumed;
      board.preparationElapsedMs += consumed;
      deltaMs -= consumed;
      if (deltaMs <= 0) return null;
    }
    board.gravityElapsedMs += deltaMs;
    if (board.softDrop) {
      board.softDropElapsedMs += deltaMs;
      const interval = Math.min(this.options.softDropIntervalMs, participant.gravityIntervalMs);
      while (board.alive && board.active && board.softDropElapsedMs >= interval) {
        board.softDropElapsedMs -= interval;
        if (!tryMove(board, 0, 1)) break;
        board.gravityElapsedMs = 0;
        board.lockElapsedMs = 0;
      }
    } else {
      while (board.alive && board.active && board.gravityElapsedMs >= participant.gravityIntervalMs) {
        board.gravityElapsedMs -= participant.gravityIntervalMs;
        if (!tryMove(board, 0, 1)) break;
        board.lockElapsedMs = 0;
      }
    }

    if (!board.active || !board.alive) return null;
    const grounded = !canPlace(board.grid, { ...board.active, y: board.active.y + 1 });
    if (!grounded) {
      board.lockElapsedMs = 0;
      return null;
    }
    const lockDeltaMs = Math.max(0, deltaMs - Math.max(0, maneuverConsumed - preparationConsumed));
    if (maneuverConsumed > preparationConsumed && lockDeltaMs === 0) return null;
    board.lockElapsedMs += lockDeltaMs;
    if (board.lockElapsedMs < (this.options.tuning?.lockDelayMs ?? LOCK_DELAY_MS)) return null;

    const source = board.active.definition.source;
    const lockedGrid = board.grid.map((row) => [...row]);
    for (const { x, y } of pieceCells(board.active)) {
      if (lockedGrid[y]) lockedGrid[y]![x] = board.active.definition.settledKind;
    }
    const clearedRows = completedRowIndices(lockedGrid);
    const lines = lockPiece(board, clearedRows.length > 0);
    board.clearFlashMs = lines > 0 ? CLEAR_FLASH_MS : 0;
    const underAttack = (this.state.pendingConflict?.incomingRows[participant.config.id] ?? 0) > 0;
    const isHuntLeader = this.options.conflictEnabled
      && this.options.conflictTargeting === 'hunt-leader'
      && scoreLeaderIds(this.competitionParticipants()).includes(participant.config.id);
    const cleanupCapacity = source === 'anomaly' || underAttack
      ? 0
      : (!this.options.conflictEnabled || this.state.isSurvival || isHuntLeader) ? ([0, 0, 1, 3, 5][lines] ?? 5) : 0;
    const current = board.nextPiece;
    if (lines > 0 && board.alive) {
      const projected = lockedGrid.map((row) => [...row]);
      clearCompletedLines(projected);
      let removedGrayRows = 0;
      while (removedGrayRows < cleanupCapacity && projected.at(-1)?.every((cell) => cell === 'garbage')) {
        projected.pop();
        removedGrayRows += 1;
      }
      this.pendingClears.set(participant.config.id, { source, lines, nextPiece: current, cleanupCapacity, underAttack, stage: 'playable' });
      if (underAttack && this.state.pendingConflict) {
        const defended = new Set(this.state.pendingConflict.defendedRecipientIds);
        defended.add(participant.config.id);
        this.state.pendingConflict.defendedRecipientIds = [...defended].sort();
      }
      this.beginClearPresentation(participant, lines, lockedGrid, clearedRows, removedGrayRows, 'highlight');
      return null;
    }
    participant.placedPieces += 1;
    this.recordLineClearStreak(participant, 0, source);
    this.scheduleSpawnAfterLock(participant, current);
    if (underAttack || cleanupCapacity > 0 || source === 'anomaly') this.nonAttackLockIds.add(participant.config.id);
    return { participantId: participant.config.id, lines, source };
  }

  private scheduleSpawnAfterLock(participant: ParticipantState, current: ParticipantState['board']['nextPiece']): void {
    if (this.state.isSurvival) this.spawnAfterLock(participant, current);
    else this.stepSpawns.set(participant.config.id, current);
  }

  private flushStepSpawns(): void {
    for (const [id, next] of this.stepSpawns) {
      const participant = this.state.participants.find((p) => p.config.id === id);
      if (participant?.board.alive) this.spawnAfterLock(participant, next);
    }
    this.stepSpawns.clear();
  }

  private spawnAfterLock(participant: ParticipantState, current: ParticipantState['board']['nextPiece']): void {
    const board = participant.board;
    if (current.source === 'anomaly') {
      if (board.pendingAnomalies[0]?.id === current.id) board.pendingAnomalies.shift();
    } else board.regularPieceIndex += 1;
    board.nextPiece = board.pendingAnomalies[0] ?? this.sequencePiece(board.regularPieceIndex);
    board.staticRenderRevision += 1;
    spawnPiece(board, current, this.spawnPreparationMs());
  }

  private spawnPreparationMs(): number {
    return this.options.tuning?.spawnPreparationMs ?? DEFAULT_GAME_TUNING.spawnPreparationMs;
  }

  private isTopGrounded(board: ParticipantState['board']): boolean {
    return board.alive && !!board.active
      && pieceCells(board.active).some(({ y }) => y >= HIDDEN_ROWS && y < HIDDEN_ROWS + TOP_MANEUVER_ROWS)
      && !canPlace(board.grid, { ...board.active, y: board.active.y + 1 });
  }

  private cancelManeuver(board: ParticipantState['board']): void {
    board.maneuverRemainingMs = 0;
    board.maneuverCancelled = true;
  }

  private extendPreparation(board: ParticipantState['board']): void {
    if (board.preparationRemainingMs <= 0) return;
    const tuning = this.options.tuning ?? DEFAULT_GAME_TUNING;
    const available = Math.max(0, tuning.spawnPreparationMaxMs - board.preparationElapsedMs - board.preparationRemainingMs);
    board.preparationRemainingMs += Math.min(tuning.spawnRotationExtensionMs, available);
  }

  private endPreparation(board: ParticipantState['board']): void {
    board.preparationRemainingMs = 0;
  }

  private tickPresentation(deltaMs: number): LockEventState[] {
    const completedLocks: LockEventState[] = [];
    this.state.roundStartPulseMs = Math.max(0, this.state.roundStartPulseMs - deltaMs);
    this.state.pressurePulseMs = Math.max(0, this.state.pressurePulseMs - deltaMs);
    this.state.finalPushPulseMs = Math.max(0, this.state.finalPushPulseMs - deltaMs);
    if (this.state.levelUpEvent) {
      this.state.levelUpEvent.pulseMs = Math.max(0, this.state.levelUpEvent.pulseMs - deltaMs);
    }
    for (const participant of this.state.participants) {
      if (participant.levelUpEvent) participant.levelUpEvent.pulseMs = Math.max(0, participant.levelUpEvent.pulseMs - deltaMs);
    }
    if (this.state.conflictImpactEvent) {
      this.state.conflictImpactEvent.pulseMs = Math.max(0, this.state.conflictImpactEvent.pulseMs - deltaMs);
    }
    for (const event of this.state.cleanupEvents) event.pulseMs = Math.max(0, event.pulseMs - deltaMs);
    this.state.cleanupEvents = this.state.cleanupEvents.filter((event) => event.pulseMs > 0);
    const pendingClears: ClearPresentationState[] = [];
    const landedClears: ClearPresentationState[] = [];
    for (const event of this.state.clearPresentations) {
      const participant = this.state.participants.find((candidate) => candidate.config.id === event.participantId);
      if (!participant?.board.alive) continue;
      event.remainingMs = Math.max(0, event.remainingMs - deltaMs);
      if (event.remainingMs > 0.001) {
        pendingClears.push(event);
      } else if (event.phase === 'highlight') {
        event.phase = 'fall';
        event.durationMs = clearFallDurationMs(event.lines);
        event.remainingMs = event.durationMs;
        pendingClears.push(event);
      } else {
        landedClears.push(event);
      }
    }
    this.state.clearPresentations = pendingClears;
    const startedBurns: MatchState['anomalyBurnEvents'] = [];
    for (const event of landedClears) {
      const participant = this.state.participants.find((candidate) => candidate.config.id === event.participantId);
      const pending = this.pendingClears.get(event.participantId);
      if (!participant || !pending) continue;
      if (pending.stage === 'playable') {
        const cleared = clearCompletedLines(participant.board.grid);
        if (cleared !== pending.lines) throw new Error(`Clear transaction drift for ${event.participantId}: ${cleared} != ${pending.lines}`);
        participant.board.staticRenderRevision += 1;
        participant.placedPieces += 1;
        participant.score += scoreForLines(pending.lines);
        this.recordLineClearStreak(participant, pending.lines, pending.source);
        if (pending.cleanupCapacity > 0) {
          const removed = removeBottomGrayRows(participant.board, pending.cleanupCapacity);
          if (removed > 0) {
            this.state.cleanupSerial += 1;
            this.state.cleanupEvents.push({ serial: this.state.cleanupSerial, participantId: event.participantId, rows: removed, pulseMs: CLEANUP_PULSE_MS });
          }
        }
        if (pending.underAttack || pending.cleanupCapacity > 0 || pending.source === 'anomaly') this.nonAttackLockIds.add(event.participantId);
        completedLocks.push({ participantId: event.participantId, lines: pending.lines, source: pending.source });
        if (pending.source === 'anomaly') {
          pending.stage = 'burn';
          const rows = participant.board.grid.slice(-pending.lines).map((row) => [...row]);
          this.state.anomalyBurnSerial += 1;
          startedBurns.push({ serial: this.state.anomalyBurnSerial, participantId: event.participantId, rows, pulseMs: ANOMALY_BURN_PULSE_MS });
          continue;
        }
      } else {
        burnBottomRows(participant.board, pending.lines);
      }
      this.finishClearTransaction(participant, pending);
      this.state.clearImpactSerial += 1;
      this.state.clearImpactEvents.push({ serial: this.state.clearImpactSerial, participantId: event.participantId, lines: event.lines });
      if (this.state.clearImpactEvents.length > 64) this.state.clearImpactEvents.shift();
    }
    const pendingBurnEvents = [];
    for (const event of this.state.anomalyBurnEvents) {
      event.pulseMs = Math.max(0, event.pulseMs - deltaMs);
      if (event.pulseMs > 0.001) {
        pendingBurnEvents.push(event);
        continue;
      }
      const participant = this.state.participants.find((candidate) => candidate.config.id === event.participantId);
      if (participant?.board.alive) {
        const sourceGrid = participant.board.grid.map((row) => [...row]);
        const removedRows = Array.from({ length: event.rows.length }, (_, index) => sourceGrid.length - event.rows.length + index);
        this.beginClearPresentation(participant, event.rows.length, sourceGrid, removedRows, 0, 'fall');
      }
      this.resolvedAnomalyBurnParticipantIds.add(event.participantId);
    }
    this.state.anomalyBurnEvents = [...pendingBurnEvents, ...startedBurns];
    for (const event of this.state.shieldInventoryEvents) event.pulseMs = Math.max(0, event.pulseMs - deltaMs);
    this.state.shieldInventoryEvents = this.state.shieldInventoryEvents.filter((event) => event.pulseMs > 0);
    for (const event of this.state.shieldChargeEvents) event.pulseMs = Math.max(0, event.pulseMs - deltaMs);
    this.state.shieldChargeEvents = this.state.shieldChargeEvents.filter((event) => event.pulseMs > 0);
    return completedLocks;
  }

  private finishClearTransaction(participant: ParticipantState, pending: PendingClear): void {
    const participantId = participant.config.id;
    this.pendingClears.delete(participantId);
    this.resolvedClearParticipantIds.add(participantId);
    const pressureRows = this.deferredPressureRows.get(participantId) ?? 0;
    this.deferredPressureRows.delete(participantId);
    if (pressureRows > 0) addGrayRows(participant.board, pressureRows);
    if (participant.board.alive && !this.state.anomalyTransition) this.scheduleSpawnAfterLock(participant, pending.nextPiece);
  }

  private beginClearPresentation(
    participant: ParticipantState,
    lines: number,
    sourceGrid: MatchState['participants'][number]['board']['grid'],
    removedRows: number[],
    removedBottomRows: number,
    phase: ClearPresentationState['phase'],
  ): void {
    this.state.clearPresentations = this.state.clearPresentations.filter((event) => event.participantId !== participant.config.id);
    this.state.clearPresentationSerial += 1;
    const durationMs = phase === 'fall' ? clearFallDurationMs(lines) : NORMAL_CLEAR_HIGHLIGHT_MS;
    this.state.clearPresentations.push({
      serial: this.state.clearPresentationSerial,
      participantId: participant.config.id,
      lines,
      phase,
      remainingMs: durationMs,
      durationMs,
      sourceGrid,
      removedRows,
      rows: settlingRows(sourceGrid, removedRows, removedBottomRows),
      boardRevision: participant.board.staticRenderRevision,
    });
  }

  private recordLineClearStreak(participant: ParticipantState, lines: number, source: 'classic' | 'anomaly'): void {
    const next = nextShieldCharge(
      participant.lineClearStreak,
      participant.shieldCharge,
      participant.shieldCount >= 3,
      lines,
      source,
      this.state.isSurvival,
    );
    participant.lineClearStreak = next.lineClearStreak;
    participant.shieldCharge = next.shieldCharge;
    if (next.kind === 'full') {
      this.recordShieldInventory(participant, 'gain', 'clear', participant.shieldCount, 1);
      participant.shieldCount += 1;
    }
    participant.shieldReady = participant.shieldCount > 0;
    if (next.kind) {
      this.state.shieldChargeSerial += 1;
      this.state.shieldChargeEvents.push({
        serial: this.state.shieldChargeSerial,
        participantId: participant.config.id,
        kind: next.kind,
        pulseMs: SHIELD_CHARGE_NOTICE_MS,
      });
    }
  }

  private recordShieldInventory(participant: ParticipantState, kind: 'gain' | 'burn',
    reason: 'clear' | 'pressure' | 'conflict', firstSlot: number, count: number): void {
    this.state.shieldInventoryEvents.push({ serial: ++this.state.shieldInventorySerial,
      participantId: participant.config.id, kind, reason, firstSlot, count,
      pulseMs: kind === 'burn' ? 1_000 : 450 });
  }

  private absorbShieldRows(participant: ParticipantState, rows: number, reason: 'pressure' | 'conflict'): number {
    const absorbed = Math.min(participant.shieldCount, rows);
    participant.shieldCount -= absorbed;
    participant.shieldReady = participant.shieldCount > 0;
    if (absorbed > 0) this.recordShieldInventory(participant, 'burn', reason, participant.shieldCount, absorbed);
    return rows - absorbed;
  }

  private hasPendingAnomalyBurn(participantId: string): boolean {
    return this.state.anomalyBurnEvents.some((event) => event.participantId === participantId);
  }

  private collectConflictAttacks(lockEvents: readonly LockEventState[]): void {
    if (!this.options.conflictEnabled) return;
    const competitionParticipants = this.state.participants.map((participant, index) => ({
      id: participant.config.id,
      score: participant.score,
      alive: participant.board.alive,
      teamId: this.options.matchVariant === 'teams' ? participantTeamId(participant.config, index) ?? undefined : undefined,
    }));
    const senders = lockEvents.flatMap((event) => {
      if (event.source !== 'classic' || this.nonAttackLockIds.has(event.participantId)) return [];
      const rows = attackRowsForLines(event.lines);
      if (rows === 0) return [];
      const recipientIds = conflictTargetIds(
        event.participantId,
        competitionParticipants,
        this.options.matchVariant,
        this.options.conflictTargeting,
      );
      return recipientIds.length > 0 ? [{ participantId: event.participantId, rows, recipientIds }] : [];
    });
    if (senders.length === 0) return;

    const incomingRows = { ...(this.state.pendingConflict?.incomingRows ?? {}) };
    for (const sender of senders) {
      for (const recipientId of sender.recipientIds) {
        incomingRows[recipientId] = (incomingRows[recipientId] ?? 0) + sender.rows;
      }
    }
    const previousSerial = Math.max(
      this.state.pendingConflict?.serial ?? 0,
      this.state.conflictImpactEvent?.serial ?? 0,
    );
    this.state.pendingConflict = {
      serial: previousSerial + 1,
      remainingWarningMs: this.options.tuning?.conflictWarningMs ?? CONFLICT_WARNING_MS,
      senders: [...(this.state.pendingConflict?.senders ?? []), ...senders]
        .sort((a, b) => a.participantId.localeCompare(b.participantId)),
      incomingRows,
      defendedRecipientIds: this.state.pendingConflict?.defendedRecipientIds ?? [],
    };
  }

  private advancePendingConflict(deltaMs: number): void {
    const pending = this.state.pendingConflict;
    if (!pending) return;
    pending.remainingWarningMs = Math.max(0, pending.remainingWarningMs - deltaMs);
    if (pending.remainingWarningMs > 0) return;
    if (Object.keys(pending.incomingRows).some((participantId) => {
      const participant = this.state.participants.find((candidate) => candidate.config.id === participantId);
      return participant?.board.alive && this.pendingClears.has(participantId)
        && !pending.defendedRecipientIds?.includes(participantId)
        && (pending.incomingRows[participantId] ?? 0) > participant.shieldCount;
    })) {
      pending.remainingWarningMs = 0.001;
      return;
    }

    const defendedRecipientIds = [...(pending.defendedRecipientIds ?? [])].sort();
    const defended = new Set(defendedRecipientIds);
    const shieldedRecipientIds: string[] = [];
    const incomingRows: Record<string, number> = {};
    for (const [participantId, rows] of Object.entries(pending.incomingRows).sort(([left], [right]) => left.localeCompare(right))) {
      const participant = this.state.participants.find((candidate) => candidate.config.id === participantId);
      if (!participant?.board.alive || defended.has(participantId)) continue;
      const remainingRows = this.absorbShieldRows(participant, rows, 'conflict');
      if (remainingRows < rows) shieldedRecipientIds.push(participantId);
      if (remainingRows === 0) continue;
      addGrayRows(participant.board, remainingRows);
      // A conflict impact can change the lowest rows during the burn hold.
      // Keep the visible target equal to the rows that the existing rule will remove.
      for (const burn of this.state.anomalyBurnEvents) {
        if (burn.participantId !== participantId || !participant.board.alive) continue;
        burn.rows = participant.board.grid.slice(-burn.rows.length).map((row) => [...row]);
      }
      incomingRows[participantId] = remainingRows;
    }
    this.state.conflictImpactEvent = {
      serial: (this.state.conflictImpactEvent?.serial ?? 0) + 1,
      incomingRows,
      maxRows: Math.max(0, ...Object.values(incomingRows)),
      pulseMs: Math.max(CONFLICT_IMPACT_PULSE_MS, MIN_CONFLICT_NOTICE_MS - (this.options.tuning?.conflictWarningMs ?? CONFLICT_WARNING_MS)),
      defendedRecipientIds,
      shieldedRecipientIds,
      senders: pending.senders,
    };
    this.state.pendingConflict = null;
  }

  private updateSurvivalTimes(): void {
    for (const participant of this.state.participants) {
      if (!participant.board.alive && participant.eliminatedAtMs === null) {
        participant.eliminatedAtMs = this.state.elapsedMs;
        participant.survivalMs = this.state.elapsedMs;
      } else if (participant.board.alive) participant.survivalMs = this.state.elapsedMs;
    }
  }

  private hasPendingImpactForAliveParticipant(): boolean {
    const pending = this.state.pendingConflict;
    if (!pending) return false;
    return this.state.participants.some((participant) => (
      participant.board.alive && (pending.incomingRows[participant.config.id] ?? 0) > 0
    ));
  }

  private resolveOutcomeWhenReady(): void {
    this.resolveOutcome();
    if (this.state.phase === 'results') this.state.anomalyTransition = null;
  }

  private resolveOutcome(): void {
    if (this.pendingClears.size > 0) return;
    if (this.hasPendingImpactForAliveParticipant()) return;
    if (this.state.isSurvival) {
      if (this.state.participants.every((participant) => !participant.board.alive)) this.resolveSurvivalOutcome();
      return;
    }
    if (this.options.matchVariant === 'teams') {
      const teams = teamScores(this.competitionParticipants());
      const activeTeams = teams.filter((team) => team.alive);
      if (activeTeams.length <= 1) {
        if (activeTeams.length === 0 && this.options.battleTimeMode === 'until-victory') {
          const finalTimes = teams.map((team) => Math.max(...this.state.participants
            .filter((participant) => team.memberIds.includes(participant.config.id))
            .map((participant) => participant.survivalMs)));
          const latest = Math.max(...finalTimes);
          const finalists = teams.filter((_team, index) => finalTimes[index] === latest);
          const bestScore = Math.max(...finalists.map((team) => team.score));
          this.resolveTeamOutcome(finalists.filter((team) => team.score === bestScore).map((team) => team.teamId));
          this.state.endReason = finalists.length > 1 ? 'simultaneous-elimination' : 'survival';
          return;
        }
        this.resolveTeamOutcome(activeTeams.map((team) => team.teamId));
        return;
      }
      if (this.state.elapsedMs >= this.state.durationMs) {
        const bestScore = Math.max(...activeTeams.map((team) => team.score));
        let winners = activeTeams.filter((team) => team.score === bestScore);
        const bestSurvivor = Math.max(...winners.map((team) => team.highestSurvivingScore));
        winners = winners.filter((team) => team.highestSurvivingScore === bestSurvivor);
        this.resolveTeamOutcome(winners.map((team) => team.teamId));
      }
      return;
    }
    const alive = this.state.participants.filter((participant) => participant.board.alive);
    if (alive.length <= 1) this.resolveSurvivalOutcome();
    else if (this.state.elapsedMs >= this.state.durationMs) this.resolveTimeoutOutcome();
  }

  private competitionParticipants() {
    return this.state.participants.map((participant, index) => ({
      id: participant.config.id,
      score: participant.score,
      alive: participant.board.alive,
      teamId: participantTeamId(participant.config, index) ?? undefined,
    }));
  }

  private resolveTeamOutcome(winnerTeams: readonly string[]): void {
    const winnerSet = new Set(winnerTeams);
    this.state.winnerIds = this.state.participants
      .filter((participant, index) => winnerSet.has(participantTeamId(participant.config, index) ?? ''))
      .map((participant) => participant.config.id);
    for (const participant of this.state.participants) participant.placement = this.state.winnerIds.includes(participant.config.id) ? 1 : 2;
    this.state.endReason = this.state.elapsedMs >= this.state.durationMs ? 'timeout' : 'survival';
    this.state.phase = 'results';
  }

  private sequencePiece(index: number) {
    return pieceDefinition(this.sequence.at(index));
  }

  private deliverLevelAnomaly(level: number, recipients = this.state.participants): void {
    const anomaly = generateAnomaly(this.state.seed, level);
    for (const participant of recipients) {
      const board = participant.board;
      if (!board.alive) continue;
      board.pendingAnomalies.push(anomaly);
      if (board.pendingAnomalies.length === 1 && (!this.state.isSurvival || !this.pendingClears.has(participant.config.id))) {
        board.nextPiece = anomaly;
        board.staticRenderRevision += 1;
      }
    }
    this.state.levelUpEvent = {
      serial: (this.state.levelUpEvent?.serial ?? 0) + 1,
      level,
      anomalyId: anomaly.id,
      pulseMs: LEVEL_UP_PULSE_MS,
    };
    if (this.state.isSurvival) {
      for (const participant of recipients) {
        if (!participant.board.alive) continue;
        participant.levelUpEvent = {
          serial: (participant.levelUpEvent?.serial ?? 0) + 1,
          level,
          anomalyId: anomaly.id,
          pulseMs: LEVEL_UP_PULSE_MS,
        };
      }
    }
    if (!this.state.isSurvival) {
      if (this.state.anomalyTransition) this.state.anomalyTransition.levels.push(level);
      else {
        this.state.anomalyTransitionSerial += 1;
        this.state.anomalyTransition = {
          serial: this.state.anomalyTransitionSerial,
          phase: 'clearing', remainingMs: ANOMALY_ARRIVAL_BURN_MS, durationMs: ANOMALY_ARRIVAL_BURN_MS,
          levels: [level],
          targets: this.state.participants.filter((p) => p.board.alive && p.board.active)
            .map((p) => ({ participantId: p.config.id, piece: structuredClone(p.board.active!) })),
        };
        for (const p of this.state.participants) { p.board.softDrop = false; p.board.softDropElapsedMs = 0; }
        this.beginAnomalyBurnWhenReady();
      }
    }
  }

  private beginAnomalyBurnWhenReady(): void {
    const transition = this.state.anomalyTransition;
    if (!transition || this.pendingClears.size > 0 || this.state.cleanupEvents.length > 0) return;
    transition.targets = this.state.participants.filter((p) => p.board.alive && p.board.active)
      .map((p) => ({ participantId: p.config.id, piece: structuredClone(p.board.active!) }));
    transition.phase = 'burning';
    transition.remainingMs = transition.durationMs;
  }

  private advanceAnomalyTransition(deltaMs: number): void {
    const transition = this.state.anomalyTransition;
    if (!transition) return;
    if (transition.phase === 'clearing') {
      this.nonAttackLockIds.clear();
      this.resolvedClearParticipantIds.clear();
      this.resolvedAnomalyBurnParticipantIds.clear();
      this.state.lockEvents = this.tickPresentation(deltaMs);
      this.collectConflictAttacks(this.state.lockEvents);
      this.beginAnomalyBurnWhenReady();
      this.updateSurvivalTimes();
      this.resolveOutcomeWhenReady();
      return;
    }
    transition.remainingMs = Math.max(0, transition.remainingMs - deltaMs);
    if (transition.remainingMs > 0.001) return;
    let appeared = false;
    for (const participant of this.state.participants) {
      if (!participant.board.alive) continue;
      participant.board.active = null;
      const anomaly = participant.board.pendingAnomalies[0];
      if (anomaly) {
        this.spawnAfterLock(participant, anomaly);
        appeared ||= participant.board.alive;
      }
    }
    if (appeared) this.state.anomalyArrivalSerial += 1;
    this.state.anomalyTransition = null;
    if (this.state.levelUpEvent) this.state.levelUpEvent.pulseMs = 0;
    this.state.lockEvents = [];
    this.updateSurvivalTimes();
    this.resolveOutcomeWhenReady();
  }

  private resolveSurvivalOutcome(): void {
    if (this.state.isSurvival) {
      const bestScore = Math.max(...this.state.participants.map((participant) => participant.score));
      this.state.winnerIds = this.state.participants
        .filter((participant) => participant.score === bestScore)
        .map((participant) => participant.config.id);
      for (const participant of this.state.participants) {
        participant.placement = 1 + this.state.participants.filter((other) => other.score > participant.score).length;
      }
      this.state.endReason = 'survival';
      this.state.phase = 'results';
      return;
    }
    const alive = this.state.participants.filter((participant) => participant.board.alive);
    const bestTime = Math.max(...this.state.participants.map((participant) => participant.survivalMs));
    const finalists = this.state.participants.filter((participant) => participant.survivalMs === bestTime);
    const simultaneous = alive.length === 0 && finalists.length > 1 && this.options.battleTimeMode === 'until-victory';
    if (alive.length === 1) {
      const winner = alive[0] as ParticipantState;
      winner.survivalMs = this.state.elapsedMs;
      this.state.winnerIds = [winner.config.id];
    } else {
      const bestScore = Math.max(...finalists.map((participant) => participant.score));
      this.state.winnerIds = finalists
        .filter((participant) => this.options.battleTimeMode !== 'until-victory' || participant.score === bestScore)
        .map((participant) => participant.config.id);
    }
    this.assignSurvivalPlacements();
    if (simultaneous) {
      for (const participant of finalists) {
        participant.placement = 1 + finalists.filter((other) => other.score > participant.score).length;
      }
    }
    this.state.endReason = simultaneous
      ? 'simultaneous-elimination' : 'survival';
    this.state.phase = 'results';
  }

  private resolveTimeoutOutcome(): void {
    const survivors = this.state.participants.filter((participant) => participant.board.alive);
    const bestScore = Math.max(...survivors.map((participant) => participant.score));
    this.state.winnerIds = survivors
      .filter((participant) => participant.score === bestScore)
      .map((participant) => participant.config.id);
    for (const participant of survivors) {
      participant.survivalMs = this.state.durationMs;
      participant.placement = 1 + survivors.filter((other) => other.score > participant.score).length;
    }
    const eliminated = this.state.participants.filter((participant) => !participant.board.alive);
    for (const participant of eliminated) {
      participant.placement = survivors.length + 1
        + eliminated.filter((other) => other.survivalMs > participant.survivalMs).length;
    }
    this.state.endReason = 'timeout';
    this.state.phase = 'results';
  }

  private assignSurvivalPlacements(): void {
    const winnerSet = new Set(this.state.winnerIds);
    const eliminated = this.state.participants.filter((participant) => !winnerSet.has(participant.config.id));
    for (const participant of this.state.participants) {
      if (winnerSet.has(participant.config.id)) {
        participant.placement = 1;
        continue;
      }
      const laterEliminations = eliminated.filter((other) => other.survivalMs > participant.survivalMs).length;
      participant.placement = 1 + winnerSet.size + laterEliminations;
    }
  }
}
