import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, type ParticipantState } from '../src/domain/types';
import { COUNTDOWN_MS, FIXED_STEP_MS, LOCK_DELAY_MS, MatchEngine, encodeMatchState } from '../src/simulation/match';
import { activePiece, pieceCells } from '../src/simulation/tetrominoes';
import { generateAnomaly } from '../src/simulation/anomaly';
import { createFixture } from './fixtures';
import { prepareClearPlaytest } from '../src/ui/clearPlaytest';

function fixture(bottomRow: number) {
  const engine = createFixture(); engine.step(COUNTDOWN_MS);
  const [trigger, other] = engine.state.participants as [ParticipantState, ParticipantState];
  trigger.placedPieces = 14;
  trigger.board.active = activePiece('O', 0, 3, BOARD_HEIGHT - 2);
  trigger.board.preparationRemainingMs = 0;
  trigger.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;
  other.board.active = activePiece('O', 0, 3, bottomRow - 1);
  other.board.preparationRemainingMs = 0;
  other.board.gravityElapsedMs = 0;
  other.board.lockElapsedMs = 0;
  return { engine, trigger, other };
}

describe('bottom-two-row anomaly protection', () => {
  it.each([BOARD_HEIGHT - 1, BOARD_HEIGHT - 2])('retains a piece whose lowest cell is row %i and delivers its queued anomaly after normal lock', bottomRow => {
    const { engine, other } = fixture(bottomRow);
    const piece = structuredClone(other.board.active);
    const grid = structuredClone(other.board.grid);
    const serial = other.board.spawnSerial;
    const regularIndex = other.board.regularPieceIndex;
    const regularNext = other.board.nextPiece.id;
    engine.step(FIXED_STEP_MS);
    const timer = other.board.lockElapsedMs;
    const gravity = other.board.gravityElapsedMs;
    expect(engine.state.anomalyTransition!.targets.map(t => t.participantId)).not.toContain('p2');
    engine.step(1000);
    expect(other.board.active).toEqual(piece);
    expect(other.board.grid).toEqual(grid);
    expect(other.board.spawnSerial).toBe(serial);
    expect(other.board.lockElapsedMs).toBe(timer);
    expect(other.board.gravityElapsedMs).toBe(gravity);
    expect(other.placedPieces).toBe(0);
    expect(other.score).toBe(0);
    expect(other.board.nextPiece.source).toBe('anomaly');
    expect(other.board.pendingAnomalies).toHaveLength(1);
    engine.step(engine.state.options.softDropIntervalMs, new Map([['p2', ['soft-drop-on']]]));
    expect(other.placedPieces).toBe(1);
    expect(other.board.active!.definition.source).toBe('anomaly');
    expect(other.board.pendingAnomalies).toHaveLength(0);
    expect(other.board.nextPiece.id).toBe(regularNext);
    expect(other.board.regularPieceIndex).toBe(regularIndex);
    expect(pieceCells({ ...piece!, y: BOARD_HEIGHT - 2 }).every(({ x, y }) => other.board.grid[y]![x] === 'O')).toBe(true);
  });

  it('still discards an active piece one row above the protected band', () => {
    const { engine, other } = fixture(BOARD_HEIGHT - 3);
    engine.step(FIXED_STEP_MS);
    expect(engine.state.anomalyTransition!.targets.map(t => t.participantId)).toContain('p2');
    engine.step(1000);
    expect(other.board.active!.definition.source).toBe('anomaly');
    expect(other.board.grid.flat().filter(Boolean)).toEqual([]);
    expect(other.placedPieces).toBe(0);
  });

  it.each([0, 1, 2, 3] as const)('uses occupied cells rather than the origin for I rotation %i', rotation => {
    const { engine, other } = fixture(BOARD_HEIGHT - 2);
    other.board.active = activePiece('I', rotation, 3, 0);
    const lowest = Math.max(...pieceCells(other.board.active).map(c => c.y));
    other.board.active.y = BOARD_HEIGHT - 2 - lowest;
    const piece = structuredClone(other.board.active);
    engine.step(FIXED_STEP_MS); engine.step(1000);
    expect(other.board.active).toEqual(piece);
    expect(other.board.pendingAnomalies).toHaveLength(1);
  });

  it('also preserves an active anomaly near the floor', () => {
    const { engine, other } = fixture(BOARD_HEIGHT - 2);
    other.board.active!.definition = generateAnomaly(engine.state.seed, 7);
    other.board.active!.y = 0;
    other.board.active!.y = BOARD_HEIGHT - 2 - Math.max(...pieceCells(other.board.active!).map(c => c.y));
    const piece = structuredClone(other.board.active);
    engine.step(FIXED_STEP_MS); engine.step(1000);
    expect(other.board.active).toEqual(piece);
    expect(other.board.pendingAnomalies).toHaveLength(1);
  });

  it('retains protection while the triggering clear finishes, including checkpoint restoration', () => {
    const { engine, trigger, other } = fixture(BOARD_HEIGHT - 1);
    prepareClearPlaytest(trigger.board, 'normal', 1);
    engine.step(FIXED_STEP_MS);
    expect(engine.state.anomalyTransition!.phase).toBe('clearing');
    const restored = MatchEngine.restore(JSON.parse(JSON.stringify(engine.checkpoint())));
    const piece = structuredClone(other.board.active);
    for (let i = 0; i < 150; i++) {
      engine.step(FIXED_STEP_MS); restored.step(FIXED_STEP_MS);
      expect(restored.checkpoint()).toEqual(engine.checkpoint());
      if (!engine.state.anomalyTransition) break;
    }
    expect(engine.state.anomalyTransition).toBeNull();
    expect(other.board.active).toEqual(piece);
    expect(other.board.nextPiece.source).toBe('anomaly');
  });

  it('preserves the same piece through pause and own-prediction restoration', () => {
    const { engine, other } = fixture(BOARD_HEIGHT - 1);
    engine.step(FIXED_STEP_MS);
    engine.pause(); const frozen = engine.checkpoint(); engine.step(5000);
    expect(engine.checkpoint()).toEqual(frozen);
    engine.resume();
    const predicted = MatchEngine.restorePrediction(encodeMatchState(engine.state), engine.predictionCheckpoint());
    engine.step(1000); predicted.stepOwnPrediction('p2', 1000);
    expect(predicted.state.participants[1]).toEqual(other);
    expect(other.board.active!.definition.source).toBe('classic');
  });
});
