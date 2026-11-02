import { describe, expect, it } from 'vitest';
import { AiController, aiPersonality, choosePlacement, difficultyProfile, enumeratePlacements, evaluateExpertGrid } from '../src/controllers/ai';
import { DEFAULT_GAME_TUNING } from '../src/domain/gameTuning';
import { BOARD_HEIGHT, type BoardState, type GameAction } from '../src/domain/types';
import { canPlace, createBoard, placeAndClear, tryMove, tryRotateClockwise } from '../src/simulation/board';
import { SeededRandom } from '../src/simulation/random';
import { generateAnomaly } from '../src/simulation/anomaly';
import { spawnPiece } from '../src/simulation/board';

const noErrors = () => {
  const tuning = structuredClone(DEFAULT_GAME_TUNING);
  tuning.ai.expert.errorChance = 0;
  tuning.ai.expert.conflictIntentChance = 0;
  return tuning;
};
function apply(board: BoardState, action: GameAction): boolean {
  if (action === 'rotate-clockwise') return tryRotateClockwise(board);
  if (action === 'move-left') return tryMove(board, -1, 0);
  if (action === 'move-right') return tryMove(board, 1, 0);
  if (action === 'move-down') return tryMove(board, 0, 1);
  throw new Error(`Unexpected AI action ${action}`);
}
function defenseFixture() {
  const board = createBoard('T', 'I');
  ['..........', '.....#..#.', '###..#.##.', '###..#####', '#.#..###.#', '##...#####', '####.#####', '####.#####'].forEach((row, i) => {
    board.grid[14 + i] = [...row].map(c => c === '#' ? 'J' : null);
  });
  return board;
}

describe('Expert safety and maneuver recovery', () => {
  it('retains every distinct landing column when empty cells surround the same shape', () => {
    const board = createBoard('O', 'I');
    const placements = enumeratePlacements(board.grid, 'O', board.active!.y);
    expect(placements).toHaveLength(9);
    expect(new Set(placements.map(p => p.x)).size).toBe(9);
  });

  it('preserves the exact shipped Expert tempo', () => {
    expect(difficultyProfile('expert', DEFAULT_GAME_TUNING)).toMatchObject({ reactionMs: 58, dropTapIntervalMs: 115 });
    expect(difficultyProfile('hard', DEFAULT_GAME_TUNING)).toMatchObject({ reactionMs: 75, dropTapIntervalMs: 150 });
  });

  it('increases the penalty as a stack approaches the spawn area', () => {
    const heights = [6, 7, 18, 19].map(height => {
      const board = createBoard('T', 'I');
      for (let y = BOARD_HEIGHT - height; y < BOARD_HEIGHT; y++) board.grid[y]![0] = 'J';
      return evaluateExpertGrid(board.grid, 0);
    });
    expect(heights[2]! - heights[3]!).toBeGreaterThan(heights[0]! - heights[1]!);
  });

  it('keeps a survivable next spawn even when seeded variation selects the second-ranked attack', () => {
    const board = createBoard('O', 'I');
    for (let y = 4; y < BOARD_HEIGHT; y++) for (let x = 2; x < 8; x++) board.grid[y]![x] = 'J';
    class AttackAndError extends SeededRandom {
      override next() { return 0; }
      override int() { return 0; }
    }
    const plan = choosePlacement(board, 'expert', new AttackAndError(1), 0, true, undefined, DEFAULT_GAME_TUNING)!;
    for (const action of plan.route!) expect(apply(board, action)).toBe(true);
    const result = placeAndClear(board.grid, board.active!)!;
    expect(canPlace(result.grid, { definition: board.nextPiece, rotation: 0, x: 3, y: 1 })).toBe(true);
  });

  it('executes only reachable placements when a wall separates the piece from a tempting landing', () => {
    const board = createBoard('O', 'I');
    board.active!.y = 17;
    for (let y = 15; y < BOARD_HEIGHT; y++) board.grid[y]![7] = 'J';
    for (let x = 0; x < 8; x++) board.grid[BOARD_HEIGHT - 1]![x] = 'J';
    const plan = choosePlacement(board, 'expert', new SeededRandom(1), 0, true, undefined, noErrors());
    expect(plan).not.toBeNull();
    expect(plan!.x).toBeLessThan(6);
    for (const action of plan!.route!) expect(apply(board, action)).toBe(true);
    expect(board.active).toMatchObject({ x: plan!.x, rotation: plan!.rotation });
    expect(placeAndClear(board.grid, board.active!)).not.toBeNull();
  });

  it('replans for a warning without a new spawn or grid change, then confirms its defensive landing', () => {
    const board = defenseFixture();
    const tuning = noErrors();
    const bias = aiPersonality(5, 'bot').placementBias;
    const ordinary = choosePlacement(board, 'expert', new SeededRandom(5), bias, false, undefined, tuning, false)!;
    const defensive = choosePlacement(board, 'expert', new SeededRandom(5), bias, false, undefined, tuning, true)!;
    expect([ordinary.x, ordinary.rotation]).not.toEqual([defensive.x, defensive.rotation]);
    const controller = new AiController(5, 'bot', 'expert', false, tuning);
    for (const action of controller.actions(board, 0)) expect(apply(board, action)).toBe(true);
    const grid = structuredClone(board.grid), serial = board.spawnSerial;
    let dropped = false;
    for (let now = 100; now <= 3000; now += 100) {
      const actions = controller.actions(board, now, true);
      if (actions.includes('move-down')) {
        expect(placeAndClear(board.grid, board.active!)!.lines).toBeGreaterThan(0);
        dropped = true;
        break;
      }
      for (const action of actions) expect(apply(board, action)).toBe(true);
    }
    expect(dropped).toBe(true);
    expect(board.grid).toEqual(grid);
    expect(board.spawnSerial).toBe(serial);
  });

  it('recovers when gravity blocks the remaining route instead of emitting impossible moves', () => {
    const board = createBoard('O', 'I');
    const tuning = noErrors();
    const controller = new AiController(5, 'bot', 'expert', false, tuning);
    for (const action of controller.actions(board, 0)) expect(apply(board, action)).toBe(true);
    // Natural descent into a divided lower well invalidates the earlier horizontal route.
    board.active!.y = 18;
    const rightEdge = board.active!.x + 3;
    for (let y = 17; y < BOARD_HEIGHT; y++) board.grid[y]![rightEdge] = 'J';
    let dropped = false;
    for (let now = 100; now <= 3000; now += 100) {
      const actions = controller.actions(board, now);
      for (const action of actions) {
        if (action === 'move-down') { dropped = true; break; }
        expect(apply(board, action)).toBe(true);
      }
      if (dropped) break;
    }
    expect(dropped).toBe(true);
    expect(placeAndClear(board.grid, board.active!)).not.toBeNull();
  });

  it('plans four Expert anomalies within a frame on average', () => {
    const boards = Array.from({ length: 4 }, (_, i) => {
      const board = createBoard('T', 'I');
      spawnPiece(board, generateAnomaly(200 + i, 1));
      board.nextPiece = generateAnomaly(200 + i, 2);
      return board;
    });
    const start = performance.now();
    for (let iteration = 0; iteration < 20; iteration++) boards.forEach((board, i) => {
      expect(choosePlacement(board, 'expert', new SeededRandom(100 + i + iteration))).not.toBeNull();
    });
    expect((performance.now() - start) / 20).toBeLessThan(16.7);
  });
});
