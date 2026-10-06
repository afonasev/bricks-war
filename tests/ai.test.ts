import { describe, expect, it } from 'vitest';
import { AiController, aiPersonality, choosePlacement, conflictAttackBonus, difficultyProfile, enumeratePlacements } from '../src/controllers/ai';
import { createBoard, tryMove, tryRotateClockwise } from '../src/simulation/board';
import { deriveSeed, SeededRandom } from '../src/simulation/random';
import { generateAnomaly } from '../src/simulation/anomaly';
import { spawnPiece } from '../src/simulation/board';

describe('computer players', () => {
  it('only proposes legal landing candidates', () => {
    const board = createBoard('T', 'I');
    const plans = enumeratePlacements(board.grid, 'T', board.active?.y ?? 0);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((plan) => plan.x >= -2 && plan.x < 12)).toBe(true);
  });

  it('gives stronger levels faster reactions and lookahead at hard and expert levels', () => {
    expect(difficultyProfile('easy').reactionMs).toBeGreaterThan(difficultyProfile('medium').reactionMs);
    expect(difficultyProfile('medium').reactionMs).toBeGreaterThan(difficultyProfile('hard').reactionMs);
    expect(difficultyProfile('hard').reactionMs / difficultyProfile('expert').reactionMs).toBeCloseTo(1.3, 1);
    expect(difficultyProfile('hard').lookahead).toBe(true);
    expect(difficultyProfile('expert').lookahead).toBe(true);
    expect(difficultyProfile('medium').lookahead).toBe(false);
    expect(difficultyProfile('easy')).toMatchObject({ errorChance: 0.60, errorMaxRank: 7 });
    expect(difficultyProfile('medium')).toMatchObject({ errorChance: 0.30, errorMaxRank: 5 });
    expect(difficultyProfile('hard')).toMatchObject({
      errorChance: 0.05,
      errorMaxRank: 3,
      conflictIntentChance: 0.15,
      reactionMs: 75,
      dropTapIntervalMs: 150,
      lookahead: true,
    });
    expect(difficultyProfile('expert')).toMatchObject({
      errorChance: 0.02,
      errorMaxRank: 2,
      conflictIntentChance: 0.70,
      reactionMs: 58,
      dropTapIntervalMs: 115,
      lookahead: true,
    });
    expect(difficultyProfile('easy').dropTapIntervalMs).toBeNull();
    expect(difficultyProfile('medium').dropTapIntervalMs).toBe(650);
    expect(difficultyProfile('hard').dropTapIntervalMs).toBe(150);
    expect(difficultyProfile('hard').dropTapIntervalMs! / difficultyProfile('expert').dropTapIntervalMs!).toBeCloseTo(1.3, 1);
  });

  it('strongly rewards conflict clears only from two lines upward', () => {
    expect([0, 1, 2, 3, 4].map(conflictAttackBonus)).toEqual([0, 0, 3_000, 4_500, 6_000]);
    expect(difficultyProfile('expert').conflictIntentChance).toBeGreaterThan(difficultyProfile('hard').conflictIntentChance);
    expect(difficultyProfile('medium').conflictIntentChance).toBe(0);
  });

  it('can choose seeded suboptimal plans at every difficulty without leaving legal candidates', () => {
    class ControlledRandom extends SeededRandom {
      constructor(private readonly trigger: boolean) { super(1); }
      override next(): number { return this.trigger ? 0 : 0.99; }
      override int(maxExclusive: number): number { return Math.max(0, maxExclusive - 1); }
    }
    for (const difficulty of ['easy', 'medium', 'hard', 'expert'] as const) {
      const board = createBoard('T', 'I');
      const best = choosePlacement(board, difficulty, new ControlledRandom(false));
      const imperfect = choosePlacement(board, difficulty, new ControlledRandom(true));
      expect(imperfect).not.toBeNull();
      expect(imperfect).not.toEqual(best);
      expect(enumeratePlacements(board.grid, 'T', board.active?.y ?? 0).some((plan) => plan.x === imperfect?.x && plan.rotation === imperfect.rotation)).toBe(true);
    }
  });

  it('derives distinct but reproducible personalities per participant', () => {
    expect(aiPersonality(55, 'ai-1')).toEqual(aiPersonality(55, 'ai-1'));
    expect(aiPersonality(55, 'ai-1')).not.toEqual(aiPersonality(55, 'ai-2'));
  });

  it('keeps expert play sequences participant-specific instead of cloning every plan', () => {
    const sequences = Array.from({ length: 12 }, (_, index) => {
      const participantId = `expert-${index + 1}`;
      const random = new SeededRandom(deriveSeed(55, participantId));
      return ['I', 'O', 'T', 'L', 'J', 'S', 'Z'].map((kind, pieceIndex) => {
        const board = createBoard(kind as 'I' | 'O' | 'T' | 'L' | 'J' | 'S' | 'Z', pieceIndex % 2 === 0 ? 'I' : 'T');
        const plan = choosePlacement(board, 'expert', random, aiPersonality(55, participantId).placementBias);
        return `${plan?.rotation}:${plan?.x}`;
      }).join('|');
    });
    expect(new Set(sequences).size).toBeGreaterThan(1);
  });

  it('chooses repeatable placements from the same seed', () => {
    const board = createBoard('T', 'I');
    const first = choosePlacement(board, 'easy', new SeededRandom(72));
    const second = choosePlacement(board, 'easy', new SeededRandom(72));
    expect(first).toEqual(second);
  });

  it('emits only common gameplay actions', () => {
    const board = createBoard('L', 'O');
    const controller = new AiController(12, 'bot', 'hard');
    const actions = controller.actions(board, 1000);
    expect(actions.length).toBeGreaterThan(0);
    expect(['move-left', 'move-right', 'rotate-clockwise', 'move-down']).toContain(actions[0]);
  });

  it('never accelerates easy drops and increases drop pace through expert', () => {
    const tapCounts = new Map<string, number>();
    for (const difficulty of ['easy', 'medium', 'hard', 'expert'] as const) {
      const board = createBoard('L', 'O');
      const controller = new AiController(31, `bot-${difficulty}`, difficulty);
      let taps = 0;
      for (let elapsedMs = 0; elapsedMs <= 10_000; elapsedMs += 10) {
        const actions = controller.actions(board, elapsedMs);
        if (actions.includes('rotate-clockwise')) tryRotateClockwise(board);
        if (actions.includes('move-left')) tryMove(board, -1, 0);
        if (actions.includes('move-right')) tryMove(board, 1, 0);
        if (actions.includes('move-down')) taps += 1;
      }
      tapCounts.set(difficulty, taps);
    }
    expect(tapCounts.get('easy')).toBe(0);
    expect(tapCounts.get('medium')).toBeGreaterThan(0);
    expect(tapCounts.get('hard')).toBeGreaterThan((tapCounts.get('medium') ?? 0) * 3);
    expect(tapCounts.get('expert')).toBeGreaterThan(tapCounts.get('hard') ?? 0);
  });

  it('confirms the final rotation and column before starting a fast drop', () => {
    const board = createBoard('L', 'O');
    const controller = new AiController(12, 'careful-hard', 'hard');
    let adjusted = false;
    let confirmedAfterAdjustment = false;
    let accelerated = false;
    for (let elapsedMs = 0; elapsedMs <= 20_000; elapsedMs += 1_000) {
      const actions = controller.actions(board, elapsedMs);
      if (actions.includes('rotate-clockwise')) {
        tryRotateClockwise(board);
        adjusted = true;
        confirmedAfterAdjustment = false;
      } else if (actions.includes('move-left')) {
        tryMove(board, -1, 0);
        adjusted = true;
        confirmedAfterAdjustment = false;
      } else if (actions.includes('move-right')) {
        tryMove(board, 1, 0);
        adjusted = true;
        confirmedAfterAdjustment = false;
      } else if (actions.includes('move-down')) {
        expect(adjusted).toBe(true);
        expect(confirmedAfterAdjustment).toBe(true);
        accelerated = true;
        break;
      } else if (adjusted) {
        confirmedAfterAdjustment = true;
      }
    }
    expect(accelerated).toBe(true);
  });

  it('cancels drop confidence and replans when incoming rows change the board', () => {
    const board = createBoard('L', 'O');
    const controller = new AiController(12, 'replanning-hard', 'hard');
    for (let elapsedMs = 0; elapsedMs <= 20_000; elapsedMs += 1_000) {
      const actions = controller.actions(board, elapsedMs);
      if (actions.includes('rotate-clockwise')) tryRotateClockwise(board);
      if (actions.includes('move-left')) tryMove(board, -1, 0);
      if (actions.includes('move-right')) tryMove(board, 1, 0);
      if (actions.includes('move-down')) break;
    }
    board.grid[board.grid.length - 1]![9] = 'garbage';
    expect(controller.actions(board, 30_000)).not.toContain('move-down');
  });

  it('plans legal anomaly placements and uses an anomaly in hard lookahead', () => {
    const board = createBoard('T', 'I');
    const activeAnomaly = generateAnomaly(411, 1);
    const nextAnomaly = generateAnomaly(411, 2);
    spawnPiece(board, activeAnomaly);
    board.nextPiece = nextAnomaly;
    const plans = enumeratePlacements(board.grid, activeAnomaly, board.active?.y ?? 0);
    expect(plans.length).toBeGreaterThan(0);
    expect(choosePlacement(board, 'hard', new SeededRandom(9))).not.toBeNull();
  });

  it('plans four hard players inside one frame on average', () => {
    const boards = Array.from({ length: 4 }, (_, index) => {
      const board = createBoard('T', 'I');
      spawnPiece(board, generateAnomaly(200 + index, 1));
      board.nextPiece = generateAnomaly(200 + index, 2);
      return board;
    });
    const start = performance.now();
    for (let iteration = 0; iteration < 20; iteration += 1) {
      boards.forEach((board, index) => choosePlacement(board, 'hard', new SeededRandom(100 + index + iteration)));
    }
    const averageFourBoardMs = (performance.now() - start) / 20;
    expect(averageFourBoardMs).toBeLessThan(16.7);
  });
});
