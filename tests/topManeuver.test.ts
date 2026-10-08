import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, HIDDEN_ROWS, type GameAction } from '../src/domain/types';
import { cloneGameTuning } from '../src/domain/gameTuning';
import { MatchEngine, COUNTDOWN_MS } from '../src/simulation/match';
import { activePiece } from '../src/simulation/tetrominoes';
import { spawnPiece } from '../src/simulation/board';
import { HumanInputRouter } from '../src/controllers/input';
import { humanPair } from './fixtures';

function fixture(y = HIDDEN_ROWS + 2, lockDelayMs = 100) {
  const tuning = cloneGameTuning();
  tuning.spawnPreparationMs = 0;
  tuning.lockDelayMs = lockDelayMs;
  const engine = new MatchEngine(humanPair(), 123, 5, {}, tuning);
  engine.step(COUNTDOWN_MS);
  const board = engine.state.participants[0]!.board;
  board.grid.forEach((row, index) => {
    row.fill(index >= y + 2 ? 'J' : null);
    row[0] = null;
    row[9] = null;
  });
  board.active = activePiece('O', 0, 3, y);
  return { engine, board };
}
function act(engine: MatchEngine, action: GameAction, ms = 1) {
  engine.step(ms, new Map([['p1', [action]]]));
}

describe('bounded maneuver on a high stack', () => {
  it.each(['move-left', 'move-right', 'rotate-clockwise'] as const)('protects a grounded piece after %s, then resumes the ordinary lock timer', action => {
    const { engine, board } = fixture();
    act(engine, action);
    engine.step(598);
    expect(board.spawnSerial).toBe(1);
    expect(board.lockElapsedMs).toBe(0);
    engine.step(1);
    expect(board.maneuverSpentMs).toBe(600);
    engine.step(99);
    expect(board.spawnSerial).toBe(1);
    engine.step(1);
    expect(board.spawnSerial).toBe(2);
    expect(board.maneuverSpentMs).toBe(0);
    expect(board.maneuverCancelled).toBe(false);
  });
  it('protects the full maneuver window even with zero ordinary lock delay', () => {
    const { engine, board } = fixture(HIDDEN_ROWS + 2, 0);
    act(engine, 'move-left');
    engine.step(599);
    expect(board.spawnSerial).toBe(1);
    engine.step(1);
    expect(board.spawnSerial).toBe(2);
  });
  it('allows several lateral corrections but never more than two seconds of grace', () => {
    const { engine, board } = fixture();
    for (let index = 0; index < 4; index++) {
      act(engine, index % 2 ? 'move-right' : 'move-left');
      engine.step(499);
      expect(board.spawnSerial).toBe(1);
    }
    expect(board.maneuverSpentMs).toBe(2000);
    act(engine, 'rotate-clockwise');
    expect(board.maneuverRemainingMs).toBe(0);
    engine.step(100);
    expect(board.spawnSerial).toBe(2);
  });
  it('failed lateral movement does not refresh the remaining grace', () => {
    const { engine, board } = fixture();
    board.active!.x = -1;
    act(engine, 'rotate-clockwise');
    engine.step(499);
    act(engine, 'move-left');
    expect(board.maneuverRemainingMs).toBe(99);
    engine.step(200);
    expect(board.spawnSerial).toBe(2);
  });
  it.each(['move-down', 'soft-drop-on'] as const)('permanently cancels grace after %s, even when down is blocked', action => {
    const { engine, board } = fixture();
    act(engine, 'rotate-clockwise', 200);
    act(engine, action);
    act(engine, 'soft-drop-off');
    act(engine, 'move-right');
    expect(board.maneuverCancelled).toBe(true);
    expect(board.maneuverRemainingMs).toBe(0);
    engine.step(100);
    expect(board.spawnSerial).toBe(2);
  });
  it.each([HIDDEN_ROWS + 3, HIDDEN_ROWS + 4])('uses occupied visible cells at the zone boundary y=%i', y => {
    const { engine, board } = fixture(y);
    act(engine, 'move-left');
    expect(board.maneuverRemainingMs).toBe(y === HIDDEN_ROWS + 3 ? 599 : 0);
  });
  it('does not pause gravity when movement opens a downward path', () => {
    const { engine, board } = fixture();
    board.grid.forEach((row, y) => { if (y >= 6) { row[7] = null; row[8] = null; } });
    act(engine, 'move-right');
    act(engine, 'move-right');
    act(engine, 'move-right');
    expect(board.active!.x).toBe(6);
    engine.step(1000);
    expect(board.active!.y).toBeGreaterThan(4);
    expect(board.maneuverSpentMs).toBe(2);
    expect(board.maneuverRemainingMs).toBe(0);
  });
  it('overlaps preparation and maneuver time instead of stacking them', () => {
    const { engine, board } = fixture();
    board.preparationRemainingMs = 400;
    act(engine, 'move-left');
    engine.step(599);
    expect(board.lockElapsedMs).toBe(0);
    expect(board.preparationRemainingMs).toBe(0);
    expect(board.maneuverSpentMs).toBe(600);
    engine.step(100);
    expect(board.spawnSerial).toBe(2);
  });
  it('preserves state across pause, checkpoint restore and equivalent time partitions', () => {
    const { engine, board } = fixture();
    act(engine, 'rotate-clockwise', 250);
    engine.pause();
    engine.step(5000);
    expect(board.maneuverRemainingMs).toBe(350);
    const restored = MatchEngine.restore(JSON.parse(JSON.stringify(engine.checkpoint())));
    engine.resume(); restored.resume();
    engine.step(350); restored.step(200); restored.step(150);
    expect(restored.checkpoint()).toEqual(engine.checkpoint());
    act(engine, 'soft-drop-on'); act(restored, 'soft-drop-on');
    const cancelled = MatchEngine.restore(JSON.parse(JSON.stringify(engine.checkpoint())));
    expect(cancelled.state.participants[0]!.board.maneuverCancelled).toBe(true);
    expect(cancelled.checkpoint()).toEqual(engine.checkpoint());
  });
  it('keeps pressure operative and does not replenish the maneuver budget', () => {
    const { engine, board } = fixture();
    act(engine, 'rotate-clockwise', 200);
    engine.state.nextPressureAtMs = engine.state.elapsedMs + 50;
    engine.step(50);
    expect(engine.state.pressureRows).toBe(1);
    expect(engine.state.attackQueues[engine.state.participants[0]!.config.id]![0]!.reason).toBe('pressure');
    expect(board.maneuverSpentMs).toBeGreaterThanOrEqual(200);
    engine.step(3000);
    expect(board.grid[BOARD_HEIGHT - 1]!.every(cell => cell === 'garbage')).toBe(true);
  });
  it('holds a real kicked T rotation and permits movement afterward', () => {
    const { engine, board } = fixture();
    board.active = activePiece('T', 0, 3, 4);
    act(engine, 'rotate-clockwise', 400);
    expect(board.active!.rotation).toBe(1);
    expect(board.maneuverRemainingMs).toBe(200);
    act(engine, 'move-right', 400);
    expect(board.spawnSerial).toBe(1);
    expect(board.maneuverSpentMs).toBe(800);
    expect(board.lockElapsedMs).toBe(0);
  });
  it('does not grant grace for an impossible rotation while retaining spawn preparation behavior', () => {
    const { engine, board } = fixture();
    board.active = activePiece('T', 0, 3, 4);
    board.grid.forEach((row, y) => { if (y < 6) row.fill('J'); });
    for (const [x,y] of [[4,4],[3,5],[4,5],[5,5]]) board.grid[y!]![x!] = null;
    board.preparationRemainingMs = 400;
    act(engine, 'rotate-clockwise');
    expect(board.active!.rotation).toBe(0);
    expect(board.maneuverRemainingMs).toBe(0);
    expect(board.preparationRemainingMs).toBe(599);
  });
  it.each(['human-1', 'gamepad-0', 'mobile-touch'] as const)('routes actual %s input into the same maneuver rule', controller => {
    const { engine, board } = fixture();
    const input = new HumanInputRouter();
    input.configure([{id:'p1',label:'Player',controller}]);
    input.setEnabled(true);
    if (controller === 'human-1') input.handleKeyDown('KeyD');
    else input.updateVirtual(controller, {left:false,right:true,rotate:false,down:false});
    engine.step(400,input.drain());
    expect(board.active!.x).toBe(4);
    expect(board.maneuverRemainingMs).toBe(200);
    expect(board.lockElapsedMs).toBe(0);
  });
  it('does not rescue a blocked spawn and rejects legacy checkpoints', () => {
    const { engine, board } = fixture();
    board.grid[HIDDEN_ROWS]!.fill('J');
    expect(spawnPiece(board, 'O')).toBe(false);
    expect(board.alive).toBe(false);
    const checkpoint = engine.checkpoint();
    expect(() => MatchEngine.restore({ ...checkpoint, version: 1 } as unknown as typeof checkpoint)).toThrow('Unsupported checkpoint version');
  });
});
