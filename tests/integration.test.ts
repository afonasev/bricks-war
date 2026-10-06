import { describe, expect, it } from 'vitest';
import { AiController } from '../src/controllers/ai';
import type { ActionsByParticipant, GameAction, ParticipantConfig } from '../src/domain/types';
import { COUNTDOWN_MS, FIXED_STEP_MS, MatchEngine } from '../src/simulation/match';
import { BOARD_HEIGHT, BOARD_WIDTH } from '../src/domain/types';
import { generateAnomaly, shapeBounds } from '../src/simulation/anomaly';
import { clearFallDurationMs } from '../src/simulation/clearPresentation';

function runMatch(configs: ParticipantConfig[], seed = 555, durationMinutes = 2): MatchEngine {
  const engine = new MatchEngine(configs, seed, durationMinutes);
  const controllers = new Map<string, AiController>();
  for (const config of configs) {
    if (config.controller === 'ai' && config.difficulty) {
      controllers.set(config.id, new AiController(seed, config.id, config.difficulty));
    }
  }
  engine.step(COUNTDOWN_MS);
  for (let tick = 0; tick < 10_000 && engine.state.phase !== 'results'; tick += 1) {
    const actions = new Map<string, GameAction[]>();
    for (const participant of engine.state.participants) {
      const controller = controllers.get(participant.config.id);
      if (controller) actions.set(participant.config.id, controller.actions(participant.board, engine.state.elapsedMs));
    }
    engine.step(FIXED_STEP_MS, actions as ActionsByParticipant);
  }
  return engine;
}

describe('complete match flows', () => {
  it.each([
    ['human-only', [
      { id: 'h1', label: 'Игрок 1', controller: 'human-1' as const },
      { id: 'h2', label: 'Игрок 2', controller: 'human-2' as const },
    ]],
    ['mixed', [
      { id: 'h1', label: 'Игрок 1', controller: 'human-1' as const },
      { id: 'ai1', label: 'ИИ 1', controller: 'ai' as const, difficulty: 'hard' as const },
    ]],
    ['AI-only', [
      { id: 'ai1', label: 'ИИ 1', controller: 'ai' as const, difficulty: 'medium' as const },
      { id: 'ai2', label: 'ИИ 2', controller: 'ai' as const, difficulty: 'hard' as const },
    ]],
  ])('delivers the first shared anomaly in a %s match', (_label, configs) => {
    const engine = new MatchEngine(configs, 8484, 2);
    engine.step(COUNTDOWN_MS);
    engine.state.participants[0]!.placedPieces = 15;
    const activeIds = engine.state.participants.map((participant) => participant.board.active?.definition.id);
    engine.step(FIXED_STEP_MS);
    expect(engine.state.participants.map((participant) => participant.board.active?.definition.id)).toEqual(activeIds);
    expect(new Set(engine.state.participants.map((participant) => participant.board.nextPiece.id)).size).toBe(1);
    expect(engine.state.participants.every((participant) => participant.board.nextPiece.source === 'anomaly')).toBe(true);
  });

  it('scores a line completed by an anomaly through the normal match path', () => {
    const engine = new MatchEngine([
      { id: 'h1', label: 'Игрок 1', controller: 'human-1' },
      { id: 'h2', label: 'Игрок 2', controller: 'human-2' },
    ], 9393, 2);
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    const anomaly = generateAnomaly(9393, 1);
    const shape = anomaly.rotations[0] ?? [];
    const { width, height } = shapeBounds(shape);
    const x = Math.floor((BOARD_WIDTH - width) / 2);
    const y = BOARD_HEIGHT - height;
    const bottomCells = new Set(shape.filter((cell) => y + cell.y === BOARD_HEIGHT - 1).map((cell) => x + cell.x));
    participant.board.grid[BOARD_HEIGHT - 1]?.fill('I');
    for (const gap of bottomCells) participant.board.grid[BOARD_HEIGHT - 1]![gap] = null;
    participant.board.active = { definition: anomaly, rotation: 0, x, y };
    participant.board.lockElapsedMs = 500 - FIXED_STEP_MS;
    engine.step(FIXED_STEP_MS);
    expect(participant.score).toBe(0);
    engine.step(180);
    engine.step(clearFallDurationMs(1));
    expect(participant.score).toBeGreaterThanOrEqual(100);
    expect(participant.placedPieces).toBe(1);
  });

  it('finishes a two-human match without controller input', () => {
    const engine = runMatch([
      { id: 'h1', label: 'Игрок 1', controller: 'human-1' },
      { id: 'h2', label: 'Игрок 2', controller: 'human-2' },
    ]);
    expect(engine.state.phase).toBe('results');
    expect(engine.state.participants.every((participant) => participant.placement !== null)).toBe(true);
  });

  it('finishes a mixed human and AI match', () => {
    const engine = runMatch([
      { id: 'h1', label: 'Игрок 1', controller: 'human-1' },
      { id: 'ai1', label: 'ИИ 1', controller: 'ai', difficulty: 'medium' },
      { id: 'ai2', label: 'ИИ 2', controller: 'ai', difficulty: 'hard' },
    ]);
    expect(engine.state.phase).toBe('results');
    expect(engine.state.winnerIds.length).toBeGreaterThan(0);
  });

  it('finishes an AI-only spectator match', () => {
    const engine = runMatch([
      { id: 'ai1', label: 'ИИ 1', controller: 'ai', difficulty: 'easy' },
      { id: 'ai2', label: 'ИИ 2', controller: 'ai', difficulty: 'easy' },
      { id: 'ai3', label: 'ИИ 3', controller: 'ai', difficulty: 'easy' },
      { id: 'ai4', label: 'ИИ 4', controller: 'ai', difficulty: 'easy' },
    ]);
    expect(engine.state.phase).toBe('results');
    expect(engine.state.participants).toHaveLength(4);
  });

  it('finishes every seeded equal and mixed difficulty pairing without illegal state', () => {
    for (const first of ['easy', 'medium', 'hard', 'expert'] as const) {
      for (const second of ['easy', 'medium', 'hard', 'expert'] as const) {
        const engine = runMatch([
          { id: 'a', label: 'A', controller: 'ai', difficulty: first },
          { id: 'b', label: 'B', controller: 'ai', difficulty: second },
        ], 900 + first.length + second.length);
        expect(engine.state.phase).toBe('results');
        expect(engine.state.endReason).not.toBeNull();
        expect(engine.state.participants.every((participant) => participant.placement !== null)).toBe(true);
      }
    }
  });

  it('keeps hard AI ahead of medium across swapped-slot seeded matches', () => {
    let hardLosses = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      for (const [first, second] of [['hard', 'medium'], ['medium', 'hard']] as const) {
        const engine = runMatch([
          { id: 'a', label: 'A', controller: 'ai', difficulty: first },
          { id: 'b', label: 'B', controller: 'ai', difficulty: second },
        ], 10_000 + seed);
        const hard = engine.state.participants.find((participant) => participant.config.difficulty === 'hard');
        const medium = engine.state.participants.find((participant) => participant.config.difficulty === 'medium');
        expect(hard?.placement).not.toBeNull();
        expect(medium?.placement).not.toBeNull();
        if ((hard?.placement ?? 2) > (medium?.placement ?? 1)) hardLosses += 1;
      }
    }
    expect(hardLosses).toBeLessThanOrEqual(1);
  });
});
