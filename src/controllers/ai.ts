import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  HIDDEN_ROWS,
  type ActivePiece,
  type AiDifficulty,
  type BoardState,
  type GameAction,
  type Grid,
  type PieceDefinition,
  type Rotation,
  type TetrominoKind,
} from '../domain/types';
import { canPlace, placeAndClear, tryMove, tryRotateClockwise } from '../simulation/board';
import { deriveSeed, SeededRandom } from '../simulation/random';
import { pieceBounds, pieceDefinition } from '../simulation/tetrominoes';
import type { GameTuning } from '../domain/gameTuning';

export interface PlacementPlan {
  rotation: Rotation;
  x: number;
  score: number;
  /** Expert executes the collision-checked route through ordinary actions. */
  route?: GameAction[];
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

/** A height near the spawn area is much more dangerous than the same height low down. */
export function evaluateExpertGrid(grid: Grid, lines: number): number {
  const heights: number[] = [];
  let holes = 0;
  for (let x = 0; x < BOARD_WIDTH; x++) {
    let first = BOARD_HEIGHT;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      if (grid[y]?.[x]) first = Math.min(first, y);
      else if (first < y) holes++;
    }
    heights.push(BOARD_HEIGHT - first);
  }
  const height = Math.max(...heights);
  const roughness = heights.slice(1).reduce((sum, h, i) => sum + Math.abs(h - heights[i]!), 0);
  return lines * 800 - heights.reduce((sum, h) => sum + h, 0) * 10
    - holes * 180 - roughness * 15 - height * 20 - Math.max(0, height - 12) ** 2 * 80;
}

type DetailedPlacement = { plan: PlacementPlan; grid: Grid; lines: number };

function expertResult(grid: Grid, active: ActivePiece): ReturnType<typeof placeAndClear> {
  const result = placeAndClear(grid, active);
  // Anomaly clears burn this many bottom rows after the ordinary line clear.
  if (result && active.definition.source === 'anomaly' && result.lines > 0) {
    result.grid.splice(BOARD_HEIGHT - result.lines, result.lines);
    result.grid.unshift(...Array.from({ length: result.lines }, () => Array(BOARD_WIDTH).fill(null)));
  }
  return result;
}

/** Search only maneuvers that can actually be issued at the current pose. */
function reachableExpertPlacements(board: BoardState): DetailedPlacement[] {
  if (!board.active) return [];
  const queue = [{ active: board.active, route: [] as GameAction[] }];
  const poses = new Set<string>();
  const landings = new Set<string>();
  const candidates: DetailedPlacement[] = [];
  for (let i = 0; i < queue.length; i++) {
    const { active, route } = queue[i]!;
    const key = `${active.rotation}:${active.x}:${active.y}`;
    if (poses.has(key)) continue;
    poses.add(key);
    const result = expertResult(board.grid, active);
    if (!result) continue;
    const landingKey = gridSignature(result.grid);
    if (!landings.has(landingKey)) {
      landings.add(landingKey);
      candidates.push({ plan: { rotation: active.rotation, x: active.x, score: evaluateExpertGrid(result.grid, result.lines), route }, ...result });
    }
    for (const action of ['move-left', 'move-right', 'rotate-clockwise'] as const) {
      const probe = { ...board, active };
      const moved = action === 'rotate-clockwise' ? tryRotateClockwise(probe) : tryMove(probe, action === 'move-left' ? -1 : 1, 0);
      if (moved && probe.active) {
        const poseKey = `${probe.active.rotation}:${probe.active.x}:${probe.active.y}`;
        if (!poses.has(poseKey)) queue.push({ active: probe.active, route: [...route, action] });
      }
    }
  }
  return candidates;
}

function expertAttackBonus(candidate: DetailedPlacement): number {
  // Reduce aggression progressively near the ceiling; never buy an attack with top-out.
  const top = candidate.grid.findIndex(row => row.some(cell => cell !== null));
  const height = top < 0 ? 0 : BOARD_HEIGHT - top;
  return conflictAttackBonus(candidate.lines) * Math.max(0, Math.min(1, (16 - height) / 8)) * 0.25;
}

function previewSpawn(definition: PieceDefinition): ActivePiece {
  return {
    definition, rotation: 0,
    x: definition.source === 'classic' ? 3 : Math.floor((BOARD_WIDTH - pieceBounds(definition).width) / 2),
    y: HIDDEN_ROWS - 1,
  };
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
      const occupied = gridSignature(result.grid);
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
  const expert = difficulty === 'expert';
  let candidates = expert ? reachableExpertPlacements(board) : enumerateDetailed(board.grid, active.definition, active.y, simple);
  if (candidates.length === 0) return null;
  const profile = difficultyProfile(difficulty, tuning);
  const conflictIntentChance = profile.conflictIntentChance;
  const conflictIntent = conflictEnabled && conflictIntentChance > 0 && conflictRandom.next() < conflictIntentChance;

  if (conflictIntent && active.definition.source !== 'anomaly') {
    for (const candidate of candidates) candidate.plan.score += expert
      ? defenseRequired ? 0 : expertAttackBonus(candidate)
      : conflictAttackBonus(candidate.lines);
  }
  if (defenseRequired) {
    for (const candidate of candidates) if (candidate.lines > 0) candidate.plan.score += expert ? 1_200 : 7_000;
  }

  if (expert) {
    const spawn = previewSpawn(board.nextPiece);
    const survivable = candidates.filter(candidate => canPlace(candidate.grid, spawn));
    // Intentional rank variation must not turn a surviving choice into an immediate loss.
    if (survivable.length) candidates = survivable;
    for (const candidate of candidates) candidate.plan.score += personalityBias * (candidate.plan.x - ((BOARD_WIDTH - 4) / 2));
    // Bound two-piece search cost without dropping any current-piece landing from evaluation.
    candidates.sort((a, b) => b.plan.score - a.plan.score);
    candidates = candidates.slice(0, 8);
  }

  if (profile.lookahead) {
    for (const candidate of candidates) {
      if (expert) {
        if (!canPlace(candidate.grid, previewSpawn(board.nextPiece))) {
          candidate.plan.score -= 100_000;
          continue;
        }
      }
      const next = enumerateDetailed(candidate.grid, board.nextPiece, expert ? HIDDEN_ROWS - 1 : 0, false, expert);
      if (conflictIntent && board.nextPiece.source !== 'anomaly') {
        for (const nextCandidate of next) nextCandidate.plan.score += expert
          ? defenseRequired ? 0 : expertAttackBonus(nextCandidate)
          : conflictAttackBonus(nextCandidate.lines);
      }
      const bestNext = next.reduce((best, plan) => Math.max(best, plan.plan.score), expert ? -100_000 : -10_000);
      candidate.plan.score += bestNext * 0.45;
    }
  }

  if (!expert) for (const candidate of candidates) {
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
  expert = false,
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
      const result = expert ? expertResult(grid, piece) : placeAndClear(grid, piece);
      if (!result) continue;
      // Preserve lower-level policy; Expert keys retain empty-column positions.
      const occupied = expert ? gridSignature(result.grid) : result.grid.map((row) => row.join('')).join('|');
      if (seen.has(occupied)) continue;
      seen.add(occupied);
      detailed.push({
        plan: { rotation: rotation as Rotation, x, score: expert ? evaluateExpertGrid(result.grid, result.lines) : evaluateGrid(result.grid, result.lines, simple) },
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
  private plannedDefenseRequired = false;
  private expectedPose: { rotation: Rotation; x: number } | null = null;

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
    const expert = this.difficulty === 'expert';
    const routeBlocked = expert && this.expectedPose !== null
      && (board.active.x !== this.expectedPose.x || board.active.rotation !== this.expectedPose.rotation);
    if (board.spawnSerial !== this.plannedSpawnSerial || currentGridSignature !== this.plannedGridSignature
      || (expert && (defenseRequired !== this.plannedDefenseRequired || routeBlocked))) {
      this.plan = choosePlacement(board, this.difficulty, this.random, this.personalityBias, this.conflictEnabled, this.conflictRandom, this.tuning, defenseRequired);
      this.plannedSpawnSerial = board.spawnSerial;
      this.plannedGridSignature = currentGridSignature;
      this.plannedDefenseRequired = defenseRequired;
      this.expectedPose = null;
      this.resetDropConfirmation();
    }
    const profile = difficultyProfile(this.difficulty, this.tuning);
    this.nextActionAtMs = elapsedMs + (profile.reactionMs * this.reactionScale);
    if (!this.plan) {
      this.resetDropConfirmation();
      return [];
    }
    if (expert && this.plan.route?.length) {
      const action = this.plan.route.shift()!;
      const probe = { ...board, active: board.active };
      const moved = action === 'rotate-clockwise' ? tryRotateClockwise(probe) : tryMove(probe, action === 'move-left' ? -1 : 1, 0);
      this.resetDropConfirmation();
      if (!moved || !probe.active) {
        // Gravity can invalidate a previously reachable route. Replan on the next decision.
        this.plannedSpawnSerial = -1;
        this.expectedPose = null;
        return [];
      }
      this.expectedPose = { x: probe.active.x, rotation: probe.active.rotation };
      return [action];
    }
    this.expectedPose = null;
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
