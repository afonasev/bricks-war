import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, type ParticipantState } from '../src/domain/types';
import { ANOMALY_ARRIVAL_BURN_MS, COUNTDOWN_MS, FIXED_STEP_MS, LOCK_DELAY_MS, MatchEngine } from '../src/simulation/match';
import { activePiece } from '../src/simulation/tetrominoes';
import { airborneBurnCells } from '../src/rendering/airborneBurn';
import { AudioEventTracker } from '../src/audio/audioEvents';
import { globalMatchEvent, participantMatchEvent } from '../src/ui/matchEventPresentation';
import { DEFAULT_GAME_TUNING } from '../src/domain/gameTuning';
import { createFixture, humanPair } from './fixtures';
import { prepareClearPlaytest } from '../src/ui/clearPlaytest';

function lockAtThreshold(p: ParticipantState) {
  p.placedPieces = 14;
  p.board.active = activePiece('O', 0, 3, BOARD_HEIGHT - 2);
  p.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;
}
function drain(engine: MatchEngine) {
  for (let tick = 0; tick < 500 && engine.state.anomalyTransition?.phase === 'clearing'; tick++) engine.step(FIXED_STEP_MS);
  expect(engine.state.anomalyTransition?.phase).toBe('burning');
}
describe('shared anomaly transition', () => {
  it('keeps the triggering lock, skips only the other active figure and resumes each regular sequence', () => {
    const engine = createFixture(); engine.step(COUNTDOWN_MS);
    const [trigger, other] = engine.state.participants as [ParticipantState, ParticipantState];
    const grid = structuredClone(other.board.grid);
    const serials = engine.state.participants.map(p => p.board.spawnSerial);
    const regular = engine.state.participants.map(p => p.board.nextPiece.id);
    lockAtThreshold(trigger); engine.step(FIXED_STEP_MS);
    expect(trigger.board.active).toBeNull();
    expect(trigger.board.grid[BOARD_HEIGHT - 1]!.filter(Boolean)).toHaveLength(2);
    expect(engine.state.anomalyTransition?.targets.map(t => t.participantId)).toEqual(['p2']);
    expect(engine.state.participants.map(p => p.board.spawnSerial)).toEqual(serials);
    expect(other.board.grid).toEqual(grid); expect(other.placedPieces).toBe(0);
    const elapsed = engine.state.elapsedMs;
    engine.step(ANOMALY_ARRIVAL_BURN_MS - 1);
    expect(engine.state.participants.map(p => p.board.spawnSerial)).toEqual(serials);
    engine.step(1, new Map([['p2', ['move-left', 'rotate-clockwise']]]));
    expect(engine.state.elapsedMs).toBe(elapsed);
    expect(engine.state.participants.map(p => p.board.spawnSerial)).toEqual(serials.map(n => n + 1));
    expect(new Set(engine.state.participants.map(p => p.board.active?.definition.id)).size).toBe(1);
    expect(engine.state.participants.every(p => p.board.active?.definition.source === 'anomaly')).toBe(true);
    expect(engine.state.participants.map(p => p.board.nextPiece.id)).toEqual(regular);
    expect(engine.state.participants.map(p => p.board.regularPieceIndex)).toEqual([1, 1]);
    expect(other.board.grid).toEqual(grid); expect(other.score).toBe(0);expect(other.lineClearStreak).toBe(0);
    expect(engine.state.anomalyArrivalSerial).toBe(1);
  });

  it.each(['normal', 'fire'] as const)('finishes the %s clear chain before starting a full one-second burn', (kind) => {
    const engine = createFixture();engine.step(COUNTDOWN_MS);
    const trigger = engine.state.participants[0]!; trigger.placedPieces = 14;
    prepareClearPlaytest(trigger.board, kind, 2);
    const serial = trigger.board.spawnSerial;engine.step(FIXED_STEP_MS);
    expect(engine.state.anomalyTransition?.phase).toBe('clearing');
    expect(trigger.placedPieces).toBe(14);expect(trigger.score).toBe(0);
    const elapsed = engine.state.elapsedMs;
    drain(engine);
    expect(trigger.placedPieces).toBe(15);expect(trigger.score).toBe(300);
    expect(trigger.board.active).toBeNull();expect(trigger.board.spawnSerial).toBe(serial);
    expect(engine.state.clearPresentations).toHaveLength(0);expect(engine.state.anomalyBurnEvents).toHaveLength(0);
    expect(engine.state.anomalyTransition?.remainingMs).toBe(1000);
    expect(engine.state.elapsedMs).toBe(elapsed);
    engine.step(999);expect(engine.state.anomalyTransition).not.toBeNull();engine.step(1);
    expect(trigger.board.active?.definition.source).toBe('anomaly');
  });

  it('retains all simultaneous locks and burns even a grounded uncommitted figure', () => {
    const engine = createFixture();engine.step(COUNTDOWN_MS);
    for (const p of engine.state.participants) lockAtThreshold(p);
    engine.step(FIXED_STEP_MS);
    expect(engine.state.anomalyTransition?.targets).toEqual([]);
    expect(engine.state.participants.map(p => p.placedPieces)).toEqual([15,15]);
    engine.step(1000);expect(engine.state.participants.every(p => p.board.active?.definition.source === 'anomaly')).toBe(true);
    const second = createFixture();second.step(COUNTDOWN_MS);
    lockAtThreshold(second.state.participants[0]!);
    second.state.participants[1]!.board.active = activePiece('O',0,3,BOARD_HEIGHT-2);
    second.state.participants[1]!.board.preparationRemainingMs = 0;
    second.step(FIXED_STEP_MS);
    expect(second.state.anomalyTransition?.targets.map(t => t.participantId)).toEqual(['p2']);
  });

  it.each(['clearing', 'burning'] as const)('restores the %s phase without drift and freezes warning, pressure and input', (phase) => {
    const engine = createFixture();engine.step(COUNTDOWN_MS);
    const p=engine.state.participants[0]!;lockAtThreshold(p);
    if(phase==='clearing')prepareClearPlaytest(p.board,'fire',2);
    engine.step(FIXED_STEP_MS);
    engine.state.pendingConflict={serial:1,remainingWarningMs:2000,senders:[],incomingRows:{p2:1}};
    const restored=MatchEngine.restore(JSON.parse(JSON.stringify(engine.checkpoint())));
    const elapsed=engine.state.elapsedMs;const nextPressure=engine.state.nextPressureAtMs;
    for(let i=0;i<phase.length;i++) {
      const actions=new Map([['p2',['move-left' as const]]]);engine.step(FIXED_STEP_MS,actions);restored.step(FIXED_STEP_MS,actions);
      expect(restored.checkpoint()).toEqual(engine.checkpoint());
    }
    expect(engine.state.elapsedMs).toBe(elapsed);expect(engine.state.nextPressureAtMs).toBe(nextPressure);
    expect(engine.state.pendingConflict.remainingWarningMs).toBe(2000);
    engine.pause();const checkpoint=engine.checkpoint();engine.step(5000);expect(engine.checkpoint()).toEqual(checkpoint);
  });

  it('emits one shared alarm at spawn, none at trigger, repetition or initial reconnect baseline', () => {
    const engine = createFixture();engine.step(COUNTDOWN_MS);engine.step(1100);
    const tracker=new AudioEventTracker();tracker.sync(engine.state);
    lockAtThreshold(engine.state.participants[0]!);engine.step(FIXED_STEP_MS);
    expect(tracker.sync(engine.state).some(e=>e.type==='level-up'||e.type==='anomaly-spawn')).toBe(false);
    expect(globalMatchEvent(engine.state,DEFAULT_GAME_TUNING.messages)).toBeNull();
    for(const p of engine.state.participants)expect(participantMatchEvent(engine.state,p.config.id,DEFAULT_GAME_TUNING.messages,[])).toBeNull();
    engine.step(1000);
    expect(tracker.sync(engine.state).filter(e=>e.type==='anomaly-spawn')).toEqual([{type:'anomaly-spawn',pan:0}]);
    expect(tracker.sync(engine.state).filter(e=>e.type==='anomaly-spawn')).toEqual([]);
    expect(new AudioEventTracker().sync(engine.state)).toEqual([]);
  });

  it('preserves individual Survival queues without a shared freeze', () => {
    const engine=new MatchEngine(humanPair(),41,5,{},null,true);engine.step(COUNTDOWN_MS);
    const active=engine.state.participants.map(p=>p.board.active?.definition.id);
    engine.state.participants[0]!.placedPieces=15;engine.step(FIXED_STEP_MS);
    expect(engine.state.anomalyTransition).toBeNull();expect(engine.acceptsGameplayInput()).toBe(true);
    expect(engine.state.participants.map(p=>p.board.active?.definition.id)).toEqual(active);
    expect(engine.state.participants.map(p=>p.board.pendingAnomalies.length)).toEqual([1,0]);
  });

  it.each([false, true])('preserves ordinary spawn and pressure behavior with Survival=%s', (survival) => {
    const engine=new MatchEngine(humanPair(),32,5,{},null,survival);engine.step(COUNTDOWN_MS);
    engine.state.finalPushActive=true;
    engine.state.elapsedMs=engine.state.nextPressureAtMs-1;
    const p=engine.state.participants[0]!;
    p.board.active=activePiece('O',0,3,BOARD_HEIGHT-2);p.board.lockElapsedMs=LOCK_DELAY_MS-1;
    engine.step(1);
    expect(engine.state.pressureRows).toBe(1);expect(engine.state.anomalyTransition).toBeNull();
    expect(p.board.regularPieceIndex).toBe(2);expect(p.placedPieces).toBe(1);
    expect(p.board.active?.y).toBe(0);
  });

  it('sweeps bottom-to-top without touching non-piece cells, including calm effects', () => {
    const piece=activePiece('O',0,3,6);
    expect(airborneBurnCells(piece,0,false).every(c=>c.remaining===1)).toBe(true);
    const halfway=airborneBurnCells(piece,0.5,false);
    expect(halfway.filter(c=>c.y===7).every(c=>c.remaining===0)).toBe(true);
    expect(halfway.filter(c=>c.y===6).every(c=>c.remaining===1)).toBe(true);
    expect(airborneBurnCells(piece,1,true).every(c=>c.remaining===0)).toBe(true);
  });
});
