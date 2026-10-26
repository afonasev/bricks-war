import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, type GameAction } from '../src/domain/types';
import { cloneGameTuning } from '../src/domain/gameTuning';
import { MatchEngine, COUNTDOWN_MS, encodeMatchState } from '../src/simulation/match';
import { activePiece, pieceCells } from '../src/simulation/tetrominoes';
import { HumanInputRouter } from '../src/controllers/input';
import { AudioEventTracker } from '../src/audio/audioEvents';
import { humanPair } from './fixtures';
import { prepareClearPlaytest } from '../src/ui/clearPlaytest';

function fixture(survival = false, rowsAboveGround = 1) {
  const tuning = cloneGameTuning();
  tuning.spawnPreparationMs = 0;
  tuning.lockDelayMs = 500;
  const engine = new MatchEngine(humanPair(), 123, 5, {}, tuning, survival);
  engine.step(COUNTDOWN_MS);
  const participant = engine.state.participants[0]!;
  const board = participant.board;
  board.active = activePiece('O', 0, 3, BOARD_HEIGHT - 2 - rowsAboveGround);
  const cells = pieceCells({ ...board.active, y: BOARD_HEIGHT - 2 });
  const tracker = new AudioEventTracker();
  tracker.sync(engine.state);
  return { engine, participant, board, cells, tracker };
}
function act(engine: MatchEngine, actions: GameAction[], ms = 1) {
  engine.step(ms, new Map([['p1', actions]]));
}

describe('accelerated contact commits the piece', () => {
  it.each([false, true])('locks on the final accelerated step without waiting (Survival %s)', survival => {
    const { engine, participant, board, cells, tracker } = fixture(survival);
    act(engine, ['soft-drop-on'], engine.state.options.softDropIntervalMs);
    expect(participant.placedPieces).toBe(1);
    expect(board.spawnSerial).toBe(2);
    expect(cells.map(({ x, y }) => board.grid[y]![x])).toEqual(['O', 'O', 'O', 'O']);
    expect(tracker.sync(engine.state)).toContainEqual({ type: 'lock', pan: -0.72 });
    const settled = structuredClone(board.grid);
    act(engine, ['move-right', 'rotate-clockwise']);
    expect(board.grid).toEqual(settled);
    expect(tracker.sync(engine.state).filter(event => event.type === 'lock')).toEqual([]);
    expect(board.softDrop).toBe(false);
  });

  it('commits immediately when down is pressed during ordinary grounded grace', () => {
    const { engine, participant, board } = fixture(false, 0);
    engine.step(100);
    expect(board.lockElapsedMs).toBe(100);
    act(engine, ['soft-drop-on']);
    expect(participant.placedPieces).toBe(1);
  });

  it('keeps natural landing adjustable and silent until its ordinary lock', () => {
    const { engine, participant, board, tracker } = fixture();
    board.gravityElapsedMs = participant.gravityIntervalMs - 1;
    engine.step(1);
    expect(participant.placedPieces).toBe(0);
    expect(tracker.sync(engine.state).filter(event => event.type === 'lock')).toEqual([]);
    act(engine, ['move-right', 'rotate-clockwise']);
    expect(board.active!.x).toBe(4);
    engine.step(499);
    expect(participant.placedPieces).toBe(1);
    expect(tracker.sync(engine.state)).toContainEqual({ type: 'lock', pan: -0.72 });
  });

  it('retains the full correction window when acceleration is released before contact', () => {
    const { engine, participant, board, tracker } = fixture(false, 2);
    act(engine, ['soft-drop-on'], engine.state.options.softDropIntervalMs);
    expect(board.active!.y).toBe(BOARD_HEIGHT - 3);
    act(engine, ['soft-drop-off']);
    board.gravityElapsedMs = participant.gravityIntervalMs - 1;
    engine.step(1);
    expect(participant.placedPieces).toBe(0);
    expect(tracker.sync(engine.state).filter(event => event.type === 'lock')).toEqual([]);
    act(engine, ['move-right', 'rotate-clockwise']);
    expect(board.active!.x).toBe(4);
    engine.step(498);
    expect(participant.placedPieces).toBe(0);
    engine.step(1);
    expect(participant.placedPieces).toBe(1);
    expect(tracker.sync(engine.state)).toContainEqual({ type: 'lock', pan: -0.72 });
  });

  it('does not treat a released short tap as held acceleration', () => {
    const { engine, participant, board } = fixture(false, 0);
    act(engine, ['soft-drop-on', 'soft-drop-off']);
    expect(participant.placedPieces).toBe(0);
    expect(board.lockElapsedMs).toBe(1);
  });

  it.each(['human-1', 'gamepad-0', 'mobile-touch'] as const)('commits through actual %s down input', controller => {
    const { engine, participant } = fixture();
    const input = new HumanInputRouter();
    input.configure([{ id: 'p1', label: 'Player', controller }]);
    input.setEnabled(true);
    if (controller === 'human-1') input.handleKeyDown('KeyS');
    else input.updateVirtual(controller, { left: false, right: false, rotate: false, down: true });
    engine.step(engine.state.options.softDropIntervalMs, input.drain());
    expect(participant.placedPieces).toBe(1);
  });

  it('commits on an occupied support cell as well as the floor', () => {
    const { engine, participant, board } = fixture(false, 4);
    board.grid[BOARD_HEIGHT - 3]![4] = 'J';
    board.active!.y = BOARD_HEIGHT - 6;
    act(engine, ['soft-drop-on'], engine.state.options.softDropIntervalMs);
    expect(participant.placedPieces).toBe(1);
    expect(board.grid[BOARD_HEIGHT - 4]![4]).toBe('O');
    expect(board.grid[BOARD_HEIGHT - 3]![4]).toBe('J');
  });

  it.each(['normal', 'fire'] as const)('commits a %s clear immediately without advancing its presentation', mode => {
    const { engine, participant, board, tracker } = fixture();
    prepareClearPlaytest(board, mode, 2);
    board.lockElapsedMs = 0;
    act(engine, ['soft-drop-on']);
    expect(board.active).toBeNull();
    expect(engine.state.clearPresentations).toHaveLength(1);
    expect(engine.state.clearPresentations[0]!.phase).toBe('highlight');
    expect(participant.score).toBe(0);
    expect(participant.placedPieces).toBe(0);
    const committed = structuredClone(board.grid);
    act(engine, ['move-right', 'rotate-clockwise']);
    expect(board.grid).toEqual(committed);
    expect(tracker.sync(engine.state).filter(event => event.type === 'clear-impact')).toEqual([]);
  });

  it('preserves the contact commit across checkpoint restore and own prediction', () => {
    const { engine } = fixture();
    act(engine, ['soft-drop-on']);
    const restored = MatchEngine.restore(JSON.parse(JSON.stringify(engine.checkpoint())));
    const predicted = MatchEngine.restorePrediction(encodeMatchState(engine.state), engine.predictionCheckpoint());
    const ms = engine.state.options.softDropIntervalMs - 1;
    engine.step(ms); restored.step(ms); predicted.stepOwnPrediction('p1', ms);
    expect(restored.checkpoint()).toEqual(engine.checkpoint());
    expect(predicted.state.participants[0]).toEqual(engine.state.participants[0]);
    expect(engine.state.participants[0]!.placedPieces).toBe(1);
  });
});
