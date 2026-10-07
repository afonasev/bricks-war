import { AudioEventTracker } from '../src/audio/audioEvents';
import { describe, expect, it } from 'vitest';
import { MatchEngine, COUNTDOWN_MS, SHIELD_PRESENTATION_MS, FIXED_STEP_MS } from '../src/simulation/match';
import { humanPair } from './fixtures';
import { shieldVisualFrame } from '../src/rendering/shieldPresentation';
import { prepareClearPlaytest } from '../src/ui/clearPlaytest';
import { staticPlayfieldRenderKey, playfieldRenderKey } from '../src/rendering/renderInvalidation';

function fixture(shields = 1, rows = 4) {
  const engine = new MatchEngine(humanPair(), 173, 5);
  engine.step(COUNTDOWN_MS); engine.state.roundStartPulseMs = 0;
  const p = engine.state.participants[0]!; p.shieldCount = shields; p.shieldReady = true;
  engine.state.pendingConflict = { serial: 1, remainingWarningMs: 1, senders: [], incomingRows: { p1: rows } };
  engine.step(2); return engine;
}
function gray(e: MatchEngine) { return e.state.participants[0]!.board.grid.filter(r => r.some(c => c === 'garbage')).length; }

describe('shield reflection lifecycle', () => {
  it('emits shield sound once and only emits impact when residuals actually arrive', () => {
    const e = new MatchEngine(humanPair(), 173, 5), tracker = new AudioEventTracker();
    e.step(COUNTDOWN_MS); tracker.sync(e.state);
    e.state.participants[0]!.shieldCount = 1;
    e.state.pendingConflict = {serial:1,remainingWarningMs:1,senders:[],incomingRows:{p1:4}}; e.step(2);
    expect(tracker.sync(e.state).filter(e => ['shield-block','conflict-impact'].includes(e.type)).map(e=>e.type)).toEqual(['shield-block']);
    e.step(SHIELD_PRESENTATION_MS);
    expect(tracker.sync(e.state).filter(e => ['shield-block','conflict-impact'].includes(e.type)).map(e=>e.type)).toEqual(['conflict-impact']);
    expect(tracker.sync(e.state).filter(e => ['shield-block','conflict-impact'].includes(e.type))).toEqual([]);
  });
  it('inserts residuals after the exact end, never on a render or a second spend', () => {
    const e = fixture(), p = e.state.participants[0]!;
    expect(gray(e)).toBe(0); expect(p.shieldCount).toBe(0);
    expect(e.state.conflictImpactEvent?.incomingRows).toEqual({});
    e.step(SHIELD_PRESENTATION_MS - 1); expect(gray(e)).toBe(0);
    p.shieldCount = 1; p.shieldReady = true;
    e.step(1); expect(gray(e)).toBe(3); expect(p.shieldCount).toBe(1);
    expect(e.state.conflictImpactEvent?.incomingRows.p1).toBe(3);
    e.step(1); expect(gray(e)).toBe(3);
  });
  it('returns a fully protected board and composes playable input with a cosmetic lift', () => {
    const e = fixture(3, 2), p = e.state.participants[0]!, grid = structuredClone(p.board.grid), x = p.board.active!.x;
    e.step(100, new Map([['p1', ['move-left']]]));
    expect(p.board.active!.x).toBe(x - 1); expect(p.board.grid).toEqual(grid);
    expect(shieldVisualFrame(e.state.shieldPresentations[0]!).liftCells).toBeGreaterThan(0);
    e.step(SHIELD_PRESENTATION_MS); expect(gray(e)).toBe(0); expect(e.state.shieldPresentations).toEqual([]);
  });
  it('retains a committed residual impact when another shield resolves on the same tick', () => {
    const e = fixture(), tracker = new AudioEventTracker(); tracker.sync(e.state);
    e.state.participants[1]!.shieldCount = 1;
    e.state.pendingConflict = {serial:2,remainingWarningMs:700,senders:[],incomingRows:{p2:1}};
    e.step(SHIELD_PRESENTATION_MS);
    expect(e.state.conflictImpactEvent?.incomingRows).toEqual({p1:3});
    expect(tracker.sync(e.state).filter(e=>e.type==='conflict-impact')).toHaveLength(1);
    expect(gray(e)).toBe(3);
  });
  it('freezes on pause and round trips residual debt', () => {
    const e = fixture(); e.step(280); e.pause('manual');
    const before = e.checkpoint(); e.step(5000); expect(e.checkpoint()).toEqual(before);
    const restored = MatchEngine.restore(JSON.parse(JSON.stringify(before)));
    e.resume('manual'); restored.resume('manual');
    for (let n = 0; n < 50; n++) { e.step(FIXED_STEP_MS); restored.step(FIXED_STEP_MS); expect(restored.checkpoint()).toEqual(e.checkpoint()); }
    expect(gray(e)).toBe(3);
  });
  it('queues later unshielded and shielded impacts without overtaking', () => {
    const e = fixture(2, 1); e.step(100);
    e.state.pendingConflict = { serial: 2, remainingWarningMs: 1, senders: [], incomingRows: { p1: 3 } }; e.step(2);
    expect(e.state.shieldPresentations).toHaveLength(2); expect(gray(e)).toBe(0);
    e.state.pendingConflict = { serial: 3, remainingWarningMs: 1, senders: [], incomingRows: { p1: 1 } }; e.step(2);
    e.step(SHIELD_PRESENTATION_MS); expect(gray(e)).toBe(0);
    e.step(SHIELD_PRESENTATION_MS); expect(gray(e)).toBe(3);
    expect(e.state.shieldInventoryEvents.filter(x => x.kind === 'burn').reduce((n,x) => n+x.count,0)).toBeLessThanOrEqual(2);
  });
  it('waits for a new clear transaction at the insertion boundary', () => {
    const e = fixture(); e.step(600);
    prepareClearPlaytest(e.state.participants[0]!.board, 'normal', 2); e.step(FIXED_STEP_MS);
    e.step(100); expect(gray(e)).toBe(0); expect(e.state.shieldPresentations[0]?.remainingMs).toBe(0);
    for (let n = 0; n < 100 && e.state.shieldPresentations.length; n++) e.step(FIXED_STEP_MS);
    expect(gray(e)).toBe(3);
  });
  it('uses pressure feedback and does not change the common cadence', () => {
    const e = fixture(1, 1); e.step(SHIELD_PRESENTATION_MS);
    const p = e.state.participants[0]!; p.shieldCount = 1; p.shieldReady = true;
    e.state.nextPressureAtMs = e.state.elapsedMs + 1; e.step(2);
    expect(e.state.shieldPresentations).toHaveLength(1); expect(gray(e)).toBe(0);
    const next = e.state.nextPressureAtMs; e.step(100); expect(e.state.nextPressureAtMs).toBe(next);
    e.step(SHIELD_PRESENTATION_MS); expect(gray(e)).toBe(0);
  });
  it('cancels only eliminated debt and keeps timeout results behind residual insertion', () => {
    const e = fixture(); e.state.durationMs = e.state.elapsedMs;
    e.step(100); expect(e.state.phase).toBe('playing');
    e.step(SHIELD_PRESENTATION_MS); expect(gray(e)).toBe(3); expect(e.state.phase).toBe('results');
    const other = fixture(); other.eliminate('p1'); expect(other.state.shieldPresentations).toEqual([]);
  });
  it('makes phase geometry independent of counts and invalidates the lifted static grid', () => {
    const one = fixture(1, 4), many = fixture(3, 8);
    one.step(220); many.step(220);
    expect(shieldVisualFrame(one.state.shieldPresentations[0]!)).toEqual(shieldVisualFrame(many.state.shieldPresentations[0]!));
    const before = staticPlayfieldRenderKey(one.state, 'x', 100, 100);
    const dynamic = playfieldRenderKey(one.state,'x',100,100,0,true);
    one.step(100); expect(playfieldRenderKey(one.state,'x',100,100,0,true)).not.toBe(dynamic);
    one.step(SHIELD_PRESENTATION_MS); expect(staticPlayfieldRenderKey(one.state,'x',100,100)).not.toBe(before);
  });
});
