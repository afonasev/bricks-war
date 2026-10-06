import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  type ActivePiece,
  type AiDifficulty,
  type BoardState,
  type GameAction,
  type Grid,
  type PieceDefinition,
  type Rotation,
  type TetrominoKind,
} from '../domain/types';
import { placeAndClear } from '../simulation/board';
import { deriveSeed, SeededRandom } from '../simulation/random';
import { pieceDefinition } from '../simulation/tetrominoes';
import type { GameTuning } from '../domain/gameTuning';

export interface PlacementPlan {
  rotation: Rotation;
  x: number;
  score: number;
}

export interface DifficultyProfile {
  reactionMs: number;
  dropTapIntervalMs: number | null;
  lookahead: boolean;
  errorChance: number;
  errorMaxRank: number;
  conflictIntentChance: number;
}

const PROFILES: Record<AiDifficulty, DifficultyProfile> = {
  easy: { reactionMs: 320, dropTapIntervalMs: null, lookahead: false, errorChance: 0.60, errorMaxRank: 7, conflictIntentChance: 0 },
  medium: { reactionMs: 180, dropTapIntervalMs: 650, lookahead: false, errorChance: 0.30, errorMaxRank: 5, conflictIntentChance: 0 },
  hard: { reactionMs: 75, dropTapIntervalMs: 150, lookahead: true, errorChance: 0.05, errorMaxRank: 3, conflictIntentChance: 0.15 },
  expert: { reactionMs: 58, dropTapIntervalMs: 115, lookahead: true, errorChance: 0.02, errorMaxRank: 2, conflictIntentChance: 0.70 },
};

export function difficultyProfile(difficulty: AiDifficulty, tuning?: Readonly<GameTuning>): DifficultyProfile {
  const base = PROFILES[difficulty];
  const override = tuning?.ai[difficulty];
  return override ? { ...base, ...override } : base;
}

export function aiPersonality(seed: number, participantId: string): { reactionScale: number; placementBias: number } {
  const random = new SeededRandom(deriveSeed(seed, `${participantId}:personality`));
  return {
    reactionScale: 0.9 + (random.next() * 0.2),
    placementBias: (random.next() - 0.5) * 40,
  };
}

export function evaluateGrid(grid: Grid, lines: number, simple = false): number {
  const heights: number[] = [];
  let holes = 0;
  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    let first = BOARD_HEIGHT;
    let occupiedSeen = false;
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      if (grid[y]?.[x]) {
        if (!occupiedSeen) first = y;
        occupiedSeen = true;
      } else if (occupiedSeen) {
        holes += 1;
      }
    }
    heights.push(BOARD_HEIGHT - first);
  }
  const aggregateHeight = heights.reduce((sum, height) => sum + height, 0);
  const bumpiness = heights.slice(1).reduce((sum, height, index) => sum + Math.abs(height - (heights[index] ?? 0)), 0);
  const terminalHeight = Math.max(...heights);
  if (simple) return (lines * 700) - (aggregateHeight * 6) - (terminalHeight * 2);
  return (lines * 1000) - (aggregateHeight * 7) - (holes * 45) - (bumpiness * 5) - (terminalHeight * 3);
}

export function enumeratePlacements(
  grid: Grid,
  input: TetrominoKind | PieceDefinition,
  startY: number,
  simple = false,
): PlacementPlan[] {
  const definition = pieceDefinition(input);
  const plans: PlacementPlan[] = [];
  const seen = new Set<string>();
  for (let rotation = 0; rotation < definition.rotations.length; rotation += 1) {
    const cells = definition.rotations[rotation] ?? [];
    const minX = Math.min(...cells.map((cell) => cell.x));
    const maxX = Math.max(...cells.map((cell) => cell.x));
    for (let x = -minX; x <= BOARD_WIDTH - 1 - maxX; x += 1) {
      const piece: ActivePiece = { definition, rotation: rotation as Rotation, x, y: startY };
      const result = placeAndClear(grid, piece);
      if (!result) continue;
      const occupied = result.grid.map((row) => row.join('')).join('|');
      if (seen.has(occupied)) continue;
      seen.add(occupied);
      plans.push({ rotation: rotation as Rotation, x, score: evaluateGrid(result.grid, result.lines, simple) });
    }
  }
  return plans;
}

export function choosePlacement(
  board: BoardState,
  difficulty: AiDifficulty,
  random: SeededRandom,
  personalityBias = 0,
  conflictEnabled = true,
  conflictRandom = random,
  tuning?: Readonly<GameTuning>,
  defenseRequired = false,
): PlacementPlan | null {
  const active = board.active;
  if (!active) return null;
  const simple = difficulty === 'easy';
  const candidates = enumerateDetailed(board.grid, active.definition, active.y, simple);
  if (candidates.length === 0) return null;
  const profile = difficultyProfile(difficulty, tuning);
  const conflictIntentChance = profile.conflictIntentChance;
  const conflictIntent = conflictEnabled && conflictIntentChance > 0 && conflictRandom.next() < conflictIntentChance;

  if (conflictIntent && active.definition.source !== 'anomaly') {
    for (const candidate of candidates) candidate.plan.score += conflictAttackBonus(candidate.lines);
  }
  if (defenseRequired) {
    for (const candidate of candidates) if (candidate.lines > 0) candidate.plan.score += 7_000;
  }

  if (profile.lookahead) {
    for (const candidate of candidates) {
      const next = enumerateDetailed(candidate.grid, board.nextPiece, 0, false);
      if (conflictIntent && board.nextPiece.source !== 'anomaly') {
        for (const nextCandidate of next) nextCandidate.plan.score += conflictAttackBonus(nextCandidate.lines);
      }
      const bestNext = next.reduce((best, plan) => Math.max(best, plan.plan.score), -10_000);
      candidate.plan.score += bestNext * 0.45;
    }
  }

  for (const candidate of candidates) {
    candidate.plan.score += personalityBias * (candidate.plan.x - ((BOARD_WIDTH - 4) / 2));
  }

  candidates.sort((a, b) => b.plan.score - a.plan.score);
  if (random.next() < profile.errorChance && candidates.length > 1) {
    const maxIndex = Math.min(profile.errorMaxRank - 1, candidates.length - 1);
    return candidates[1 + random.int(maxIndex)]?.plan ?? candidates[0]?.plan ?? null;
  }
  return candidates[0]?.plan ?? null;
}

export function conflictAttackBonus(lines: number): number {
  if (lines < 2) return 0;
  if (lines === 2) return 3_000;
  if (lines === 3) return 4_500;
  return 6_000;
}

function gridSignature(grid: Grid): string {
  return grid.map((row) => row.map((cell) => cell ?? '.').join('')).join('|');
}

function enumerateDetailed(
  grid: Grid,
  input: TetrominoKind | PieceDefinition,
  startY: number,
  simple: boolean,
): Array<{ plan: PlacementPlan; grid: Grid; lines: number }> {
  const definition = pieceDefinition(input);
  const detailed: Array<{ plan: PlacementPlan; grid: Grid; lines: number }> = [];
  const seen = new Set<string>();
  for (let rotation = 0; rotation < definition.rotations.length; rotation += 1) {
    const cells = definition.rotations[rotation] ?? [];
    const minX = Math.min(...cells.map((cell) => cell.x));
    const maxX = Math.max(...cells.map((cell) => cell.x));
    for (let x = -minX; x <= BOARD_WIDTH - 1 - maxX; x += 1) {
      const piece: ActivePiece = { definition, rotation: rotation as Rotation, x, y: startY };
      const result = placeAndClear(grid, piece);
      if (!result) continue;
      const occupied = result.grid.map((row) => row.join('')).join('|');
      if (seen.has(occupied)) continue;
      seen.add(occupied);
      detailed.push({
        plan: { rotation: rotation as Rotation, x, score: evaluateGrid(result.grid, result.lines, simple) },
        grid: result.grid,
        lines: result.lines,
      });
    }
  }
  return detailed;
}

export class AiController {
  private readonly random: SeededRandom;
  private readonly conflictRandom: SeededRandom;
  private plan: PlacementPlan | null = null;
  private plannedSpawnSerial = -1;
  private plannedGridSignature = '';
  private confirmedPlanKey: string | null = null;
  private nextActionAtMs = 0;
  private nextDropTapAtMs = Number.POSITIVE_INFINITY;
  private readonly reactionScale: number;
  private readonly personalityBias: number;

  constructor(
    seed: number,
    participantId: string,
    private readonly difficulty: AiDifficulty,
    private readonly conflictEnabled = true,
    private readonly tuning?: Readonly<GameTuning>,
  ) {
    this.random = new SeededRandom(deriveSeed(seed, participantId));
    this.conflictRandom = new SeededRandom(deriveSeed(seed, `${participantId}:conflict`));
    const personality = aiPersonality(seed, participantId);
    this.reactionScale = personality.reactionScale;
    this.personalityBias = personality.placementBias;
  }

  actions(board: BoardState, elapsedMs: number, defenseRequired = false): GameAction[] {
    if (!board.alive || !board.active || elapsedMs < this.nextActionAtMs) return [];
    const currentGridSignature = gridSignature(board.grid);
    if (board.spawnSerial !== this.plannedSpawnSerial || currentGridSignature !== this.plannedGridSignature) {
      this.plan = choosePlacement(board, this.difficulty, this.random, this.personalityBias, this.conflictEnabled, this.conflictRandom, this.tuning, defenseRequired);
      this.plannedSpawnSerial = board.spawnSerial;
      this.plannedGridSignature = currentGridSignature;
      this.resetDropConfirmation();
    }
    const profile = difficultyProfile(this.difficulty, this.tuning);
    this.nextActionAtMs = elapsedMs + (profile.reactionMs * this.reactionScale);
    if (!this.plan) {
      this.resetDropConfirmation();
      return [];
    }
    if (board.active.rotation !== this.plan.rotation) {
      this.resetDropConfirmation();
      return ['rotate-clockwise'];
    }
    if (board.active.x < this.plan.x) {
      this.resetDropConfirmation();
      return ['move-right'];
    }
    if (board.active.x > this.plan.x) {
      this.resetDropConfirmation();
      return ['move-left'];
    }
    if (!placeAndClear(board.grid, board.active)) {
      this.resetDropConfirmation();
      return [];
    }

    const planKey = `${board.spawnSerial}:${currentGridSignature}:${this.plan.rotation}:${this.plan.x}`;
    if (this.confirmedPlanKey !== planKey) {
      this.confirmedPlanKey = planKey;
      this.nextDropTapAtMs = profile.dropTapIntervalMs === null
        ? Number.POSITIVE_INFINITY
        : elapsedMs + (profile.dropTapIntervalMs * this.reactionScale);
      return [];
    }
    return this.dropActions(elapsedMs);
  }

  private resetDropConfirmation(): void {
    this.confirmedPlanKey = null;
    this.nextDropTapAtMs = Number.POSITIVE_INFINITY;
  }

  private dropActions(elapsedMs: number): GameAction[] {
    const dropInterval = difficultyProfile(this.difficulty, this.tuning).dropTapIntervalMs;
    if (dropInterval === null || elapsedMs < this.nextDropTapAtMs) return [];
    this.nextDropTapAtMs = elapsedMs + (dropInterval * this.reactionScale);
    return ['move-down'];
  }
}
