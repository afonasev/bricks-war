import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, type ParticipantState, type PieceDefinition } from '../src/domain/types';
import {
  COUNTDOWN_MS,
  CONFLICT_WARNING_MS,
  ANOMALY_BURN_PULSE_MS,
  DEFAULT_DURATION_MINUTES,
  FINAL_PUSH_PULSE_MS,
  FIXED_STEP_MS,
  LEVEL_UP_PULSE_MS,
  LOCK_DELAY_MS,
  MatchEngine,
  SOFT_DROP_INTERVAL_MS,
  SOLO_PRESSURE_START_MS,
  gravityIntervalMs,
  nextShieldCharge,
  scoreForLines,
  attackRowsForLines,
  validateDurationMinutes,
  validateMatchOptions,
  validateParticipants,
  validateSurvivalParticipants,
} from '../src/simulation/match';
import { createFixture, humanPair, serializableState } from './fixtures';
import { activePiece } from '../src/simulation/tetrominoes';
import { cloneGameTuning } from '../src/domain/gameTuning';
import { clearFallDurationMs } from '../src/simulation/clearPresentation';

const TEST_ANOMALY: PieceDefinition = {
  id: 'test-anomaly-o',
  source: 'anomaly',
  settledKind: 'anomaly',
  rotations: [[{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }]],
};

function prepareClassicClear(participant: ParticipantState, lines: 1 | 2 | 3 | 4): void {
  participant.board.grid.forEach((row) => row.fill(null));
  if (lines === 1) {
    participant.board.grid[BOARD_HEIGHT - 1]?.fill('J');
    for (let x = 3; x <= 6; x += 1) participant.board.grid[BOARD_HEIGHT - 1]![x] = null;
    participant.board.active = activePiece('I', 0, 3, BOARD_HEIGHT - 2);
  } else if (lines === 2) {
    for (let y = BOARD_HEIGHT - 2; y < BOARD_HEIGHT; y += 1) {
      participant.board.grid[y]?.fill('J');
      participant.board.grid[y]![4] = null;
      participant.board.grid[y]![5] = null;
    }
    participant.board.active = activePiece('O', 0, 3, BOARD_HEIGHT - 2);
  } else {
    for (let y = BOARD_HEIGHT - lines; y < BOARD_HEIGHT; y += 1) {
      participant.board.grid[y]?.fill('J');
      participant.board.grid[y]![4] = null;
    }
    participant.board.active = activePiece('I', 1, 2, BOARD_HEIGHT - 4);
  }
  participant.board.gravityElapsedMs = 0;
  participant.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;
}

function grayRows(participant: ParticipantState): number {
  let count = 0;
  for (let y = BOARD_HEIGHT - 1; y >= 0 && participant.board.grid[y]?.every((cell) => cell === 'garbage'); y -= 1) count += 1;
  return count;
}

function finishPlayableClear(engine: MatchEngine, lines: number): void {
  for (let step = 0; step < 4 && engine.state.clearPresentations.length > 0; step += 1) {
    if (engine.state.globalEventHold) engine.step(engine.state.globalEventHold.remainingMs);
    else engine.step(Math.max(1, engine.state.clearPresentations[0]?.remainingMs ?? clearFallDurationMs(lines)));
  }
  expect(engine.state.clearPresentations).toHaveLength(0);
}

function finishAnomalyBurn(engine: MatchEngine, lines: number): void {
  engine.step(ANOMALY_BURN_PULSE_MS);
  engine.step(clearFallDurationMs(lines));
}

function prepareTopOut(participant: ParticipantState): void {
  for (let y = 0; y < 4; y += 1) {
    for (let x = 3; x <= 6; x += 1) participant.board.grid[y]![x] = 'J';
  }
  participant.board.active = activePiece('O', 0, 3, BOARD_HEIGHT - 2);
  participant.board.gravityElapsedMs = 1000;
}

describe('match engine', () => {
  it('validates participant count and unique human controls', () => {
    expect(validateParticipants([humanPair()[0]!])).toHaveLength(0);
    expect(validateParticipants(humanPair())).toHaveLength(0);
    expect(validateParticipants([
      { id: 'a', label: 'A', controller: 'human-1' },
      { id: 'b', label: 'B', controller: 'human-1' },
    ])).not.toHaveLength(0);
    expect(validateParticipants([
      { id: 'a', label: 'A', controller: 'human-1' },
      { id: 'b', label: 'B', controller: 'human-2' },
      { id: 'c', label: 'C', controller: 'gamepad-0' },
      { id: 'd', label: 'D', controller: 'gamepad-1' },
    ])).toHaveLength(0);
  });

  it('allows one to four human Survival players but rejects AI and duplicate controllers', () => {
    expect(validateSurvivalParticipants([humanPair()[0]!])).toHaveLength(0);
    expect(validateSurvivalParticipants([...humanPair(), { id: 'p3', label: 'P3', controller: 'gamepad-0' }, { id: 'p4', label: 'P4', controller: 'gamepad-1' }])).toHaveLength(0);
    expect(validateSurvivalParticipants([{ id: 'ai', label: 'ИИ', controller: 'ai', difficulty: 'easy' }])).not.toHaveLength(0);
    expect(validateSurvivalParticipants([{ id: 'a', label: 'A', controller: 'human-1' }, { id: 'b', label: 'B', controller: 'human-1' }])).not.toHaveLength(0);
  });

  it('validates duration boundaries and defaults to five minutes', () => {
    expect(validateDurationMinutes(2)).toHaveLength(0);
    expect(validateDurationMinutes(10)).toHaveLength(0);
    expect(validateDurationMinutes(0)).not.toHaveLength(0);
    expect(validateDurationMinutes(1)).not.toHaveLength(0);
    expect(validateDurationMinutes(11)).not.toHaveLength(0);
    expect(validateDurationMinutes(1.5)).not.toHaveLength(0);
    expect(createFixture().state.durationMs).toBe(DEFAULT_DURATION_MINUTES * 60_000);
  });

  it('requires a complete four-player roster for team matches', () => {
    expect(validateMatchOptions(humanPair(), { matchVariant: 'teams' })).not.toHaveLength(0);
    expect(validateMatchOptions([...humanPair(), { id: 'a', label: 'A', controller: 'ai', difficulty: 'easy' }, { id: 'b', label: 'B', controller: 'ai', difficulty: 'easy' }], { matchVariant: 'teams' })).toHaveLength(0);
    expect(() => new MatchEngine(humanPair(), 1, 5, { matchVariant: 'teams' })).toThrow(/режима 2×2/);
  });

  it('uses the fixed line-clear score table', () => {
    expect([0, 1, 2, 3, 4].map(scoreForLines)).toEqual([0, 100, 300, 500, 800]);
  });

  it.each([false, true])('qualifies classic clears by mode (Survival %s)', (survival) => {
    for (const source of ['classic', 'anomaly'] as const) for (const lines of [0, 1, 2, 3, 4]) {
      const qualifies = source === 'classic' && (survival ? lines > 0 : lines === 1);
      expect(nextShieldCharge(1, 1, false, lines, source, survival)).toEqual({
        lineClearStreak: qualifies ? 2 : 0, shieldCharge: 0, kind: qualifies ? 'full' : null,
      });
    }
    expect(nextShieldCharge(4, 0, true, 1, 'classic', survival)).toEqual({ lineClearStreak: 5, shieldCharge: 0, kind: null });
  });

  it('earns whole shields at landing on every consecutive clear after the first', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    for (let clear = 0; clear < 4; clear += 1) {
      if (engine.state.globalEventHold) engine.step(engine.state.globalEventHold.remainingMs);
      prepareClassicClear(participant, 1);
      engine.step(FIXED_STEP_MS + 1);
      expect(participant.shieldCount).toBe(Math.max(0, clear - 1));
      finishPlayableClear(engine, 1);
      expect(participant.shieldCount).toBe(clear);
      expect(participant.lineClearStreak).toBe(clear + 1);
      expect(participant.shieldCharge).toBe(0);
      expect(engine.state.shieldChargeEvents.every(event => event.kind === 'full')).toBe(true);
    }
    engine.state.pendingConflict = { serial: 1, remainingWarningMs: 1, senders: [], incomingRows: { p1: 2 } };
    engine.step(2);
    expect(participant.shieldCount).toBe(1);
    prepareClassicClear(participant, 1);
    engine.step(FIXED_STEP_MS + 1); finishPlayableClear(engine, 1);
    expect(participant.shieldCount).toBe(2);
    expect(participant.lineClearStreak).toBe(5);
  });

  it.each([false, true])('multi-line eligibility applies at actual landing (Survival %s)', (survival) => {
    const engine = new MatchEngine(humanPair(), 92, 5, {}, null, survival);
    engine.step(COUNTDOWN_MS);
    const p = engine.state.participants[0]!;
    for (const lines of [1, 2] as const) {
      prepareClassicClear(p, lines); engine.step(FIXED_STEP_MS + 1); finishPlayableClear(engine, lines);
    }
    expect(p.shieldCount).toBe(survival ? 1 : 0);
    expect(p.lineClearStreak).toBe(survival ? 2 : 0);
  });

  it('keeps until-victory Battle on single-line shield eligibility and restores its unbounded checkpoint', () => {
    const engine = new MatchEngine(humanPair(), 93, 5, { battleTimeMode: 'until-victory' });
    engine.step(COUNTDOWN_MS);
    const p = engine.state.participants[0]!;
    p.lineClearStreak = 1;
    prepareClassicClear(p, 2); engine.step(FIXED_STEP_MS + 1); finishPlayableClear(engine, 2);
    expect(p.lineClearStreak).toBe(0); expect(p.shieldCount).toBe(0);
    expect(engine.state.isSurvival).toBe(false); expect(engine.state.durationMs).toBe(Infinity);
    const restored = MatchEngine.restore(engine.checkpoint());
    expect(restored.checkpoint()).toEqual(engine.checkpoint());
  });

  it.each(Array.from({length: 4}, (_, shields) => shields))('absorbs rows individually with %s shields', (shields) => {
    for (let rows = 1; rows <= 8; rows++) {
      const engine = createFixture(); engine.step(COUNTDOWN_MS);
      const p = engine.state.participants[0]!;
      p.shieldCount = shields; p.shieldReady = shields > 0;
      engine.state.pendingConflict = { serial: 1, remainingWarningMs: 1, senders: [
        {participantId:'p2', rows:1, recipientIds:['p1']}, {participantId:'p2', rows:rows-1, recipientIds:['p1']},
      ], incomingRows: { p1: rows } };
      engine.step(2);
      expect(grayRows(p)).toBe(Math.max(0, rows - shields));
      expect(p.shieldCount).toBe(Math.max(0, shields - rows));
      expect(p.shieldReady).toBe(p.shieldCount > 0);
      expect(engine.state.shieldInventoryEvents.filter(e => e.kind === 'burn').reduce((n,e) => n+e.count,0)).toBe(Math.min(shields, rows));
    }
  });

  it('retains partial impacts until pending clear landing without double-spending', () => {
    const engine = createFixture(); engine.step(COUNTDOWN_MS);
    const p = engine.state.participants[0]!;
    p.shieldCount = 1; p.shieldReady = true;
    prepareClassicClear(p, 1); engine.step(FIXED_STEP_MS);
    engine.state.pendingConflict = { serial: 1, remainingWarningMs: 1, senders: [], incomingRows: { p1: 3 } };
    engine.step(2);
    expect(grayRows(p)).toBe(0); expect(p.shieldCount).toBe(1);
    expect(engine.state.pendingConflict).not.toBeNull();
    finishPlayableClear(engine, 1); engine.step(2);
    expect(grayRows(p)).toBe(2); expect(p.shieldCount).toBe(0);
    expect(engine.state.shieldInventoryEvents.filter(e => e.kind === 'burn')).toHaveLength(1);
  });

  it('incoming attack permits charging while active defense preserves shields', () => {
    const engine = createFixture(); engine.step(COUNTDOWN_MS);
    const p = engine.state.participants[0]!; p.lineClearStreak = 1; p.shieldCount = 1;
    engine.state.pendingConflict = { serial: 1, remainingWarningMs: 1000, senders: [], incomingRows: { p1: 3 } };
    prepareClassicClear(p, 1); engine.step(FIXED_STEP_MS); finishPlayableClear(engine, 1); engine.step(1001);
    expect(p.shieldCount).toBe(2); expect(grayRows(p)).toBe(0);
    expect(engine.state.shieldInventoryEvents.some(e => e.kind === 'burn')).toBe(false);
  });

  it('maps qualifying clears to capped conflict rows', () => {
    expect([0, 1, 2, 3, 4, 5].map(attackRowsForLines)).toEqual([0, 0, 1, 3, 4, 4]);
  });

  it.each([[1, 0], [2, 1], [3, 3], [4, 4]] as const)(
    'turns a %i-line normal lock into %i attack rows',
    (lines, rows) => {
      const engine = createFixture();
      engine.step(COUNTDOWN_MS);
      prepareClassicClear(engine.state.participants[0]!, lines);
      engine.step(FIXED_STEP_MS);
      expect(engine.state.lockEvents).toEqual([]);
      finishPlayableClear(engine, lines);
      expect(engine.state.lockEvents).toContainEqual({ participantId: 'p1', lines, source: 'classic' });
      expect(engine.state.pendingConflict?.incomingRows.p2 ?? 0).toBe(rows);
      if (rows === 0) expect(engine.state.pendingConflict).toBeNull();
    },
  );

  it('broadcasts the full attack to every other active participant and disables it by option', () => {
    const configs = [...humanPair(), { id: 'p3', label: 'ИИ', controller: 'ai' as const, difficulty: 'easy' as const }];
    const enabled = new MatchEngine(configs, 91);
    enabled.step(COUNTDOWN_MS);
    prepareClassicClear(enabled.state.participants[0]!, 3);
    enabled.step(FIXED_STEP_MS);
    finishPlayableClear(enabled, 3);
    expect(enabled.state.pendingConflict?.incomingRows).toEqual({ p2: 3, p3: 3 });

    const disabled = new MatchEngine(configs, 91, 5, { conflictEnabled: false });
    disabled.step(COUNTDOWN_MS);
    prepareClassicClear(disabled.state.participants[0]!, 4);
    disabled.step(FIXED_STEP_MS);
    finishPlayableClear(disabled, 4);
    expect(disabled.state.pendingConflict).toBeNull();
  });

  it('applies Hunt the Leader and team-safe recipient policies without changing earned rows', () => {
    const freeForAll = new MatchEngine([
      ...humanPair(),
      { id: 'p3', label: 'ИИ', controller: 'ai', difficulty: 'easy' },
    ], 92, 5, { conflictTargeting: 'hunt-leader' });
    freeForAll.step(COUNTDOWN_MS);
    freeForAll.state.participants[1]!.score = 1_000;
    freeForAll.state.participants[2]!.score = 300;
    prepareClassicClear(freeForAll.state.participants[0]!, 4);
    freeForAll.step(FIXED_STEP_MS);
    finishPlayableClear(freeForAll, 4);
    expect(freeForAll.state.pendingConflict?.senders).toEqual([{ participantId: 'p1', rows: 4, recipientIds: ['p2'] }]);

    const teams = new MatchEngine([
      { id: 'p1', label: 'P1', controller: 'human-1' },
      { id: 'p2', label: 'P2', controller: 'human-2' },
      { id: 'p3', label: 'ИИ 1', controller: 'ai', difficulty: 'easy' },
      { id: 'p4', label: 'ИИ 2', controller: 'ai', difficulty: 'easy' },
    ], 93, 5, { matchVariant: 'teams' });
    teams.step(COUNTDOWN_MS);
    prepareClassicClear(teams.state.participants[0]!, 3);
    teams.step(FIXED_STEP_MS);
    finishPlayableClear(teams, 3);
    expect(teams.state.pendingConflict?.senders).toEqual([{ participantId: 'p1', rows: 3, recipientIds: ['p3', 'p4'] }]);
  });

  it('collects simultaneous attacks fairly and accumulates a later warning-window attack', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    engine.state.participants.forEach((participant) => prepareClassicClear(participant, 2));
    engine.step(FIXED_STEP_MS);
    finishPlayableClear(engine, 2);
    expect(engine.state.pendingConflict?.senders.map((sender) => sender.participantId)).toEqual(['p1', 'p2']);
    expect(engine.state.pendingConflict?.incomingRows).toEqual({ p2: 1, p1: 1 });
    engine.step(200);
    prepareClassicClear(engine.state.participants[0]!, 3);
    engine.step(FIXED_STEP_MS);
    finishPlayableClear(engine, 3);
    expect(engine.state.pendingConflict?.incomingRows).toEqual({ p2: 1, p1: 1 });
    expect(engine.state.pendingConflict?.remainingWarningMs).toBeLessThan(CONFLICT_WARNING_MS);
  });

  it.each([{label: 'fallback', tuning: null}, {label: 'release', tuning: cloneGameTuning()}])('allows late defense in a three-second default window ($label)', ({tuning}) => {
    const engine = new MatchEngine(humanPair(), 74, 5, {}, tuning);
    engine.step(COUNTDOWN_MS);
    prepareClassicClear(engine.state.participants[0]!, 3);
    engine.step(FIXED_STEP_MS);
    finishPlayableClear(engine, 3);
    expect(engine.state.pendingConflict?.remainingWarningMs).toBe(3_000);
    engine.step(2_100);
    expect(grayRows(engine.state.participants[1]!)).toBe(0);
    prepareClassicClear(engine.state.participants[1]!, 1);
    engine.state.participants[1]!.board.lockElapsedMs = LOCK_DELAY_MS;
    engine.step(FIXED_STEP_MS);
    finishPlayableClear(engine, 1);
    expect(engine.state.pendingConflict?.defendedRecipientIds).toContain('p2');
    engine.step(3_000);
    expect(grayRows(engine.state.participants[1]!)).toBe(0);
    expect(engine.state.conflictImpactEvent?.defendedRecipientIds).toContain('p2');
  });

  it('extends a short attack warning with impact presentation instead of delaying rows', () => {
    const tuning = cloneGameTuning();
    tuning.conflictWarningMs = 350;
    const engine = new MatchEngine(humanPair(), 74, 5, {}, tuning);
    engine.step(COUNTDOWN_MS);
    engine.state.pendingConflict = {
      serial: 1,
      remainingWarningMs: 1,
      senders: [{ participantId: 'p1', rows: 1, recipientIds: ['p2'] }],
      incomingRows: { p2: 1 },
    };
    engine.step(1);
    expect(engine.state.conflictImpactEvent?.pulseMs).toBe(1_650);
  });

  it('produces order-independent same-step attack state', () => {
    const first = new MatchEngine(humanPair(), 73);
    const second = new MatchEngine([...humanPair()].reverse(), 73);
    for (const engine of [first, second]) {
      engine.step(COUNTDOWN_MS);
      prepareClassicClear(engine.state.participants.find((participant) => participant.config.id === 'p1')!, 2);
      prepareClassicClear(engine.state.participants.find((participant) => participant.config.id === 'p2')!, 3);
      engine.step(FIXED_STEP_MS);
      finishPlayableClear(engine, 3);
    }
    expect(second.state.pendingConflict?.senders).toEqual(first.state.pendingConflict?.senders);
    expect(second.state.pendingConflict?.incomingRows).toEqual(first.state.pendingConflict?.incomingRows);
  });

  it('warns for active time, freezes while paused, then impacts without changing pressure counters', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    engine.state.participants[1]!.board.active = activePiece('O', 0, 3, 8);
    prepareClassicClear(engine.state.participants[0]!, 3);
    engine.step(FIXED_STEP_MS);
    finishPlayableClear(engine, 3);
    const pressureRows = engine.state.pressureRows;
    engine.step(CONFLICT_WARNING_MS - 1);
    expect(grayRows(engine.state.participants[1]!)).toBe(0);
    engine.pause();
    engine.step(5_000);
    expect(engine.state.pendingConflict?.remainingWarningMs).toBeCloseTo(1);
    engine.resume();
    engine.step(2);
    expect(grayRows(engine.state.participants[1]!)).toBe(3);
    expect(engine.state.pressureRows).toBe(pressureRows);
    expect(engine.state.conflictImpactEvent).toMatchObject({ maxRows: 3 });
  });

  it('retains an earned attack after sender death and discards it for a dead recipient', () => {
    const retained = createFixture();
    retained.step(COUNTDOWN_MS);
    prepareClassicClear(retained.state.participants[0]!, 2);
    retained.step(FIXED_STEP_MS);
    finishPlayableClear(retained, 2);
    retained.state.participants[0]!.board.alive = false;
    retained.step(CONFLICT_WARNING_MS + 1);
    expect(grayRows(retained.state.participants[1]!)).toBe(1);

    const discarded = createFixture();
    discarded.step(COUNTDOWN_MS);
    prepareClassicClear(discarded.state.participants[0]!, 2);
    discarded.step(FIXED_STEP_MS);
    finishPlayableClear(discarded, 2);
    discarded.state.participants[1]!.board.alive = false;
    discarded.step(CONFLICT_WARNING_MS + 1);
    expect(grayRows(discarded.state.participants[1]!)).toBe(0);
  });

  it('cancels every sender addressed to an actively defended recipient in one warning batch', () => {
    const engine = new MatchEngine([
      ...humanPair(),
      { id: 'p3', label: 'ИИ', controller: 'ai', difficulty: 'easy' },
    ], 81);
    engine.step(COUNTDOWN_MS);
    prepareClassicClear(engine.state.participants[0]!, 2);
    prepareClassicClear(engine.state.participants[2]!, 3);
    engine.step(FIXED_STEP_MS);
    finishPlayableClear(engine, 3);
    engine.state.pendingConflict!.remainingWarningMs = 2_000;
    prepareClassicClear(engine.state.participants[1]!, 1);
    engine.step(800);
    finishPlayableClear(engine, 1);
    expect(engine.state.lockEvents).toContainEqual({ participantId: 'p2', lines: 1, source: 'classic' });
    expect(engine.state.pendingConflict?.defendedRecipientIds).toEqual(['p2']);
    engine.step(1_200);
    expect(grayRows(engine.state.participants[1]!)).toBe(0);
    expect(engine.state.conflictImpactEvent?.defendedRecipientIds).toEqual(['p2']);
  });

  it('uses one shield for one row without changing other recipients', () => {
    const engine = new MatchEngine([
      ...humanPair(),
      { id: 'p3', label: 'ИИ', controller: 'ai', difficulty: 'easy' },
    ], 82);
    engine.step(COUNTDOWN_MS);
    engine.state.participants[1]!.shieldCount = 1;
    engine.state.participants[1]!.shieldReady = true;
    prepareClassicClear(engine.state.participants[0]!, 3);
    engine.step(FIXED_STEP_MS);
    finishPlayableClear(engine, 3);
    engine.step(CONFLICT_WARNING_MS + 1);
    expect(grayRows(engine.state.participants[1]!)).toBe(2);
    expect(grayRows(engine.state.participants[2]!)).toBe(3);
    expect(engine.state.participants[1]!.shieldReady).toBe(false);
    expect(engine.state.conflictImpactEvent?.shieldedRecipientIds).toEqual(['p2']);
  });

  it('defers a last-survivor result until an earned impact resolves', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    prepareClassicClear(engine.state.participants[0]!, 2);
    engine.step(FIXED_STEP_MS);
    finishPlayableClear(engine, 2);
    engine.state.participants[0]!.board.alive = false;
    engine.step(CONFLICT_WARNING_MS - 1);
    expect(engine.state.phase).toBe('playing');
    engine.step(2);
    expect(engine.state.phase).toBe('results');
    expect(engine.state.winnerIds).toEqual(['p2']);
  });

  it('lets an anomaly score and remove own gray rows without attacking', () => {
    for (const conflictEnabled of [true, false]) {
      const engine = new MatchEngine(humanPair(), 121, 5, { conflictEnabled });
      engine.step(COUNTDOWN_MS);
      const participant = engine.state.participants[0]!;
      participant.board.grid.forEach((row) => row.fill(null));
      participant.board.grid[BOARD_HEIGHT - 2]?.fill('garbage');
      participant.board.grid[BOARD_HEIGHT - 1]?.fill('garbage');
      for (let y = BOARD_HEIGHT - 4; y <= BOARD_HEIGHT - 3; y += 1) {
        participant.board.grid[y]?.fill('J');
        participant.board.grid[y]![4] = null;
        participant.board.grid[y]![5] = null;
      }
      participant.board.active = activePiece(TEST_ANOMALY, 0, 3, BOARD_HEIGHT - 4);
      participant.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;
      engine.step(FIXED_STEP_MS);
      expect(participant.score).toBe(0);
      finishPlayableClear(engine, 2);
      expect(engine.state.lockEvents).toContainEqual({ participantId: 'p1', lines: 2, source: 'anomaly' });
      expect(participant.score).toBe(300);
      expect(grayRows(participant)).toBe(2);
      const activeY = participant.board.active?.y;
      engine.step(FIXED_STEP_MS, new Map([['p1', ['move-down']]]));
      expect(participant.board.active?.y).toBe(activeY);
      engine.pause();
      const pausedBurnMs = engine.state.anomalyBurnEvents[0]?.pulseMs;
      expect(ANOMALY_BURN_PULSE_MS).toBe(1_000);
      expect(pausedBurnMs).toBeCloseTo(ANOMALY_BURN_PULSE_MS - FIXED_STEP_MS);
      engine.step(ANOMALY_BURN_PULSE_MS);
      expect(engine.state.anomalyBurnEvents[0]?.pulseMs).toBe(pausedBurnMs);
      engine.resume();
      expect(engine.state.anomalyBurnEvents[0]).toMatchObject({ participantId: 'p1', serial: 1 });
      expect(engine.state.anomalyBurnEvents[0]?.rows).toHaveLength(2);
      engine.step(ANOMALY_BURN_PULSE_MS);
      expect(grayRows(participant)).toBe(2);
      expect(engine.state.anomalyBurnEvents).toHaveLength(0);
      engine.step(clearFallDurationMs(2));
      expect(grayRows(participant)).toBe(0);
      expect(engine.state.pendingConflict).toBeNull();
      expect(engine.state.participants[1]!.board.grid.flat().filter(Boolean)).toHaveLength(0);
    }
  });

  it('burns anomaly rows even when fewer gray rows exist', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    participant.board.grid.forEach((row) => row.fill(null));
    participant.board.grid[BOARD_HEIGHT - 1]?.fill('garbage');
    for (let y = BOARD_HEIGHT - 3; y <= BOARD_HEIGHT - 2; y += 1) {
      participant.board.grid[y]?.fill('J');
      participant.board.grid[y]![4] = null;
      participant.board.grid[y]![5] = null;
    }
    participant.board.active = activePiece(TEST_ANOMALY, 0, 3, BOARD_HEIGHT - 3);
    participant.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;
    engine.step(FIXED_STEP_MS);
    finishPlayableClear(engine, 2);
    expect(engine.state.anomalyBurnEvents[0]?.rows).toHaveLength(2);
    const serial = engine.state.anomalyBurnSerial;
    engine.step(FIXED_STEP_MS);
    expect(engine.state.anomalyBurnSerial).toBe(serial);

  });

  it('keeps constructed and empty bottom rows visible until an anomaly burn completes', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    participant.board.grid.forEach((row) => row.fill(null));
    participant.board.grid[BOARD_HEIGHT - 2]?.fill('J');
    participant.board.grid[BOARD_HEIGHT - 2]![0] = null;
    for (let y = BOARD_HEIGHT - 4; y <= BOARD_HEIGHT - 3; y += 1) {
      participant.board.grid[y]?.fill('J');
      participant.board.grid[y]![4] = null;
      participant.board.grid[y]![5] = null;
    }
    participant.board.active = activePiece(TEST_ANOMALY, 0, 3, BOARD_HEIGHT - 4);
    participant.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;

    engine.step(FIXED_STEP_MS);

    finishPlayableClear(engine, 2);

    const burn = engine.state.anomalyBurnEvents[0];
    expect(burn?.rows).toHaveLength(2);
    expect(burn?.rows[0]?.[1]).toBe('J');
    expect(burn?.rows[1]?.every((cell) => cell === null)).toBe(true);
    expect(participant.board.grid[BOARD_HEIGHT - 2]?.[1]).toBe('J');
    finishAnomalyBurn(engine, 2);
    expect(participant.board.grid.flat().filter((cell) => cell === 'J')).toHaveLength(0);
  });

  it('keeps burn feedback for every anomaly that clears on the same step', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    for (const participant of engine.state.participants) {
      participant.board.grid.forEach((row) => row.fill(null));
      participant.board.grid[BOARD_HEIGHT - 1]?.fill('garbage');
      for (let y = BOARD_HEIGHT - 3; y <= BOARD_HEIGHT - 2; y += 1) {
        participant.board.grid[y]?.fill('J');
        participant.board.grid[y]![4] = null;
        participant.board.grid[y]![5] = null;
      }
      participant.board.active = activePiece(TEST_ANOMALY, 0, 3, BOARD_HEIGHT - 3);
      participant.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;
    }
    engine.step(FIXED_STEP_MS);
    finishPlayableClear(engine, 2);
    expect(engine.state.anomalyBurnSerial).toBe(2);
    expect(engine.state.anomalyBurnEvents.map((event) => event.participantId).sort()).toEqual(['p1', 'p2']);
    expect(engine.state.pendingConflict).toBeNull();
  });

  it('does not advance survival time during countdown', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS - FIXED_STEP_MS);
    expect(engine.state.phase).toBe('countdown');
    expect(engine.state.elapsedMs).toBe(0);
    engine.step(FIXED_STEP_MS);
    expect(engine.state.phase).toBe('playing');
    expect(engine.state.elapsedMs).toBe(0);
  });

  it('starts solo-survival gray-row pressure at three minutes', () => {
    const engine = new MatchEngine([humanPair()[0]!], 1);
    expect(SOLO_PRESSURE_START_MS).toBe(180_000);
    expect(engine.state.nextPressureAtMs).toBe(SOLO_PRESSURE_START_MS);

    engine.step(COUNTDOWN_MS);
    engine.state.elapsedMs = SOLO_PRESSURE_START_MS - 1;
    engine.step(1);

    expect(engine.state.pressureRows).toBe(1);
    expect(engine.state.nextPressureAtMs).toBe(SOLO_PRESSURE_START_MS + 15_000);
  });

  it.each([false, true])('shortens Survival pressure gaps to five seconds (multiplayer=%s)', (multiplayer) => {
    const engine = new MatchEngine(multiplayer ? humanPair() : [humanPair()[0]!], 1, 5, {}, null, true);
    engine.step(COUNTDOWN_MS);
    // Only jump the clock; retain normal one-ms simulation steps at each boundary.
    const pulseTimes = [180_000, 195_000, 209_000, 222_000, 234_000, 245_000,
      255_000, 264_000, 272_000, 279_000, 285_000, 290_000, 295_000, 300_000];
    for (const [index, time] of pulseTimes.entries()) {
      if (engine.state.globalEventHold) engine.step(engine.state.globalEventHold.remainingMs);
      for (const participant of engine.state.participants) participant.board.grid.forEach((row) => row.fill(null));
      engine.state.elapsedMs = time - 2;
      engine.step(1);
      expect(engine.state.pressureRows).toBe(index);
      engine.step(1);
      expect(engine.state.pressureRows).toBe(index + 1);
      expect(engine.state.nextPressureAtMs).toBe(time + Math.max(5_000, 15_000 - index * 1_000));
      for (const participant of engine.state.participants) expect(grayRows(participant)).toBe(1);
    }
  });

  it('advances the common cadence through shield absorption and an eliminated board', () => {
    const engine = new MatchEngine(humanPair(), 1, 5, {}, null, true);
    engine.step(COUNTDOWN_MS);
    const [protectedPlayer, eliminated] = engine.state.participants;
    protectedPlayer!.shieldCount = 2;
    protectedPlayer!.shieldReady = true;
    engine.eliminate(eliminated!.config.id);
    engine.state.elapsedMs = 180_000 - 1;
    engine.step(1);
    expect(engine.state.nextPressureAtMs).toBe(195_000);
    expect(protectedPlayer!.shieldCount).toBe(1);
    if (engine.state.globalEventHold) engine.step(engine.state.globalEventHold.remainingMs);
    engine.state.elapsedMs = 195_000 - 1;
    engine.step(1);
    expect(engine.state.pressureRows).toBe(2);
    expect(engine.state.nextPressureAtMs).toBe(209_000);
    expect(protectedPlayer!.shieldCount).toBe(0);
    expect(grayRows(protectedPlayer!)).toBe(0);
    expect(grayRows(eliminated!)).toBe(0);
    engine.state.elapsedMs = 209_000 - 1;
    engine.step(1);
    expect(grayRows(protectedPlayer!)).toBe(1);
    expect(engine.state.nextPressureAtMs).toBe(222_000);
  });

  it.each(['manual', 'hidden'] as const)('freezes an accelerated pressure boundary under %s pause', (reason) => {
    const engine = new MatchEngine([humanPair()[0]!], 1);
    engine.step(COUNTDOWN_MS);
    engine.state.elapsedMs = 180_000 - 1;
    engine.step(1);
    engine.step(FINAL_PUSH_PULSE_MS);
    engine.state.elapsedMs = 195_000 - 1;
    engine.pause(reason);
    engine.step(60_000);
    expect(engine.state.elapsedMs).toBe(194_999);
    expect(engine.state.nextPressureAtMs).toBe(195_000);
    expect(engine.state.pressureRows).toBe(1);
    engine.resume(reason);
    engine.step(1);
    expect(engine.state.pressureRows).toBe(2);
    expect(engine.state.nextPressureAtMs).toBe(209_000);
  });

  it('catches up each shortened gap and preserves cadence through checkpoint restoration', () => {
    const engine = new MatchEngine([humanPair()[0]!], 1);
    engine.step(COUNTDOWN_MS);
    engine.state.elapsedMs = 180_000 - 1;
    engine.state.participants[0]!.shieldCount = 100;
    engine.state.participants[0]!.shieldReady = true;
    engine.step(1);
    engine.step(FINAL_PUSH_PULSE_MS);
    const restored = MatchEngine.restore(engine.checkpoint());
    engine.step(120_000);
    for (const gap of [15_000, 14_000, 13_000, 12_000, 11_000, 10_000, 9_000, 8_000, 7_000, 6_000, 5_000, 5_000, 5_000]) {
      restored.step(gap);
    }
    for (const candidate of [engine, restored]) {
      expect(candidate.state.elapsedMs).toBe(300_000);
      expect(candidate.state.pressureRows).toBe(14);
      expect(candidate.state.nextPressureAtMs).toBe(305_000);
      expect(candidate.state.participants[0]!.shieldCount).toBe(86);
    }
  });

  it('keeps multiplayer Survival running until every board is eliminated and ranks by lines', () => {
    const engine = new MatchEngine(humanPair(), 1, 5, { conflictEnabled: true }, null, true);
    engine.step(COUNTDOWN_MS);
    expect(engine.state.options.conflictEnabled).toBe(false);
    const [first, second] = engine.state.participants;
    first!.score = 100;
    first!.board.alive = false;
    engine.step(FIXED_STEP_MS);
    expect(engine.state.phase).toBe('playing');
    expect(engine.state.pendingConflict).toBeNull();
    second!.score = 800;
    second!.board.alive = false;
    engine.step(FIXED_STEP_MS);
    expect(engine.state.phase).toBe('results');
    expect(second!.placement).toBe(1);
    expect(first!.placement).toBe(2);
  });

  it('keeps Survival progression independent while regular pieces remain shared', () => {
    const engine = new MatchEngine(humanPair(), 29, 5, {}, null, true);
    engine.step(COUNTDOWN_MS);
    const [first, second] = engine.state.participants;
    first!.placedPieces = 15;
    engine.step(FIXED_STEP_MS);
    expect(first!.gravityLevel).toBe(1);
    expect(second!.gravityLevel).toBe(0);
    expect(first!.board.pendingAnomalies).toHaveLength(1);
    expect(second!.board.pendingAnomalies).toHaveLength(0);
    expect(first!.board.nextPiece.source).toBe('anomaly');
    expect(second!.board.nextPiece.classicKind).toBe(engine.sequence.at(second!.board.regularPieceIndex));
    expect(first!.levelUpEvent).toMatchObject({ level: 1, pulseMs: LEVEL_UP_PULSE_MS });
    expect(second!.levelUpEvent).toBeNull();
    expect(engine.state.globalEventHold).toBeNull();
  });

  it('uses one shield to block a timed pressure batch', () => {
    const engine = new MatchEngine([humanPair()[0]!], 1);
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    participant.shieldCount = 1;
    participant.shieldReady = true;
    engine.state.elapsedMs = SOLO_PRESSURE_START_MS - 1;

    engine.step(1);

    expect(grayRows(participant)).toBe(0);
    expect(participant.shieldCount).toBe(0);
    expect(participant.shieldReady).toBe(false);
  });

  it('shows each of 3, 2, and 1 for exactly one second', () => {
    const engine = createFixture();
    expect(Math.ceil(engine.state.countdownMs / 1000)).toBe(3);
    engine.step(1_000);
    expect(Math.ceil(engine.state.countdownMs / 1000)).toBe(2);
    engine.step(1_000);
    expect(Math.ceil(engine.state.countdownMs / 1000)).toBe(1);
    engine.step(999);
    expect(engine.state.phase).toBe('countdown');
    engine.step(1);
    expect(engine.state.phase).toBe('playing');
  });

  it('changes gravity from the placed-piece high-water mark', () => {
    expect(gravityIntervalMs(0)).toBe(1000);
    expect(gravityIntervalMs(1)).toBeCloseTo(920, 2);
    expect(gravityIntervalMs(100)).toBe(100);
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    engine.state.participants[0]!.placedPieces = 15;
    engine.step(FIXED_STEP_MS);
    expect(engine.state.gravityLevel).toBe(1);
    engine.state.participants[0]!.board.alive = false;
    engine.state.participants[1]!.placedPieces = 0;
    engine.step(FIXED_STEP_MS);
    expect(engine.state.gravityLevel).toBe(1);
  });

  it('derives one next-step level after simultaneous threshold locks', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    for (const participant of engine.state.participants) {
      participant.placedPieces = 14;
      participant.board.active = activePiece('O', 0, 3, BOARD_HEIGHT - 2);
      participant.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;
    }
    engine.step(FIXED_STEP_MS);
    expect(engine.state.participants.map((participant) => participant.placedPieces)).toEqual([15, 15]);
    expect(engine.state.maxPlacedPieces).toBe(15);
    expect(engine.state.gravityLevel).toBe(1);
    expect(engine.state.levelUpEvent).toMatchObject({ serial: 1, level: 1 });
    const nextIds = engine.state.participants.map((participant) => participant.board.nextPiece.id);
    expect(new Set(nextIds).size).toBe(1);
    expect(engine.state.participants.every((participant) => participant.board.nextPiece.source === 'anomaly')).toBe(true);
  });

  it('queues the same anomaly next for every survivor without changing active pieces or the regular queue', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    const activeIds = engine.state.participants.map((participant) => participant.board.active?.definition.id);
    const regularIds = engine.state.participants.map((participant) => engine.sequence.at(participant.board.regularPieceIndex));
    engine.state.participants[0]!.placedPieces = 15;
    engine.step(FIXED_STEP_MS);
    expect(engine.state.participants.map((participant) => participant.board.active?.definition.id)).toEqual(activeIds);
    expect(engine.state.participants.map((participant) => participant.board.regularPieceIndex)).toEqual([1, 1]);
    expect(engine.state.participants.map((participant) => participant.board.nextPiece.id)).toEqual([
      engine.state.levelUpEvent?.anomalyId,
      engine.state.levelUpEvent?.anomalyId,
    ]);
    expect(engine.state.participants.map((participant) => engine.sequence.at(participant.board.regularPieceIndex))).toEqual(regularIds);
  });

  it('preserves FIFO order when several levels are crossed in one step', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    engine.state.participants[0]!.placedPieces = 45;
    engine.step(FIXED_STEP_MS);
    for (const participant of engine.state.participants) {
      expect(participant.board.pendingAnomalies).toHaveLength(3);
      expect(participant.board.nextPiece.id).toBe(participant.board.pendingAnomalies[0]?.id);
      expect(new Set(participant.board.pendingAnomalies.map((piece) => piece.id)).size).toBe(3);
    }
    expect(engine.state.levelUpEvent).toMatchObject({ serial: 3, level: 3 });
  });

  it('delivers queued anomalies before the deferred regular piece without consuming the seven-bag entry', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    const deferredRegular = engine.sequence.at(1);
    engine.state.participants[1]!.placedPieces = 15;
    engine.step(FIXED_STEP_MS);
    const anomaly = participant.board.nextPiece;
    engine.step(LEVEL_UP_PULSE_MS);

    participant.board.active = activePiece('O', 0, 3, BOARD_HEIGHT - 2);
    participant.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;
    engine.step(FIXED_STEP_MS);
    expect(participant.board.active?.definition.id).toBe(anomaly.id);
    expect(participant.board.regularPieceIndex).toBe(1);
    expect(participant.board.nextPiece.classicKind).toBe(deferredRegular);

    participant.board.grid.forEach((row) => row.fill(null));
    const activeAnomaly = participant.board.active;
    expect(activeAnomaly).not.toBeNull();
    if (activeAnomaly) {
      const height = Math.max(...activeAnomaly.definition.rotations[0]!.map((cell) => cell.y)) + 1;
      activeAnomaly.y = BOARD_HEIGHT - height;
    }
    participant.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;
    engine.step(FIXED_STEP_MS);
    expect(participant.board.active?.definition.classicKind).toBe(deferredRegular);
    expect(participant.board.regularPieceIndex).toBe(2);
    expect(participant.board.nextPiece.classicKind).toBe(engine.sequence.at(2));
  });

  it('does not deliver anomalies to players already eliminated at the delivery boundary', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    engine.state.participants[1]!.board.alive = false;
    engine.state.participants[0]!.placedPieces = 15;
    engine.step(FIXED_STEP_MS);
    expect(engine.state.participants[0]!.board.pendingAnomalies).toHaveLength(1);
    expect(engine.state.participants[1]!.board.pendingAnomalies).toHaveLength(0);
  });

  it('uses the normal top-out path when a queued anomaly cannot spawn', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    engine.state.participants[1]!.placedPieces = 15;
    engine.step(FIXED_STEP_MS);
    const anomaly = participant.board.nextPiece;
    engine.step(LEVEL_UP_PULSE_MS);
    const spawnX = Math.floor((10 - (Math.max(...anomaly.rotations[0]!.map((cell) => cell.x)) + 1)) / 2);
    for (const cell of anomaly.rotations[0] ?? []) {
      const row = participant.board.grid[1 + cell.y];
      if (row) row[spawnX + cell.x] = 'J';
    }
    participant.board.active = activePiece('O', 0, 3, BOARD_HEIGHT - 2);
    participant.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;
    engine.step(FIXED_STEP_MS);
    expect(participant.board.alive).toBe(false);
    expect(participant.eliminatedAtMs).toBe(engine.state.elapsedMs);
  });

  it('freezes the level-up event while paused and serializes it deterministically', () => {
    const first = createFixture();
    const second = createFixture();
    for (const engine of [first, second]) {
      engine.step(COUNTDOWN_MS);
      engine.state.participants[0]!.placedPieces = 15;
      engine.step(FIXED_STEP_MS);
    }
    expect(serializableState(first.state)).toBe(serializableState(second.state));
    first.pause();
    const before = serializableState(first.state);
    first.step(5_000);
    expect(serializableState(first.state)).toBe(before);
  });

  it('holds every board and gameplay clock for the complete shared level-up presentation', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    participant.board.softDrop = true;
    participant.board.softDropElapsedMs = 40;
    participant.placedPieces = 15;
    const elapsedBeforeLevel = engine.state.elapsedMs;
    const xBeforeHold = participant.board.active!.x;

    engine.step(FIXED_STEP_MS);
    expect(engine.state.globalEventHold).toMatchObject({ kind: 'level-up', remainingMs: LEVEL_UP_PULSE_MS, level: 1 });
    expect(engine.state.phase).toBe('playing');
    expect(engine.state.pauseReasons).toEqual([]);
    expect(participant.board.softDrop).toBe(false);
    const elapsedAtHold = engine.state.elapsedMs;
    expect(elapsedAtHold).toBe(elapsedBeforeLevel + FIXED_STEP_MS);

    engine.step(600, new Map([['p1', ['move-left']]]));
    expect(engine.state.globalEventHold?.remainingMs).toBe(600);
    expect(engine.state.elapsedMs).toBe(elapsedAtHold);
    expect(participant.board.active?.x).toBe(xBeforeHold);

    engine.pause('manual');
    const pausedHold = engine.state.globalEventHold?.remainingMs;
    engine.step(5_000);
    expect(engine.state.globalEventHold?.remainingMs).toBe(pausedHold);
    engine.resume('manual');
    engine.step(600, new Map([['p1', ['move-left']]]));
    expect(engine.state.globalEventHold).toBeNull();
    expect(engine.state.elapsedMs).toBe(elapsedAtHold);
    expect(participant.board.active?.x).toBe(xBeforeHold);

    engine.step(FIXED_STEP_MS, new Map([['p1', ['move-left']]]));
    expect(engine.state.elapsedMs).toBe(elapsedAtHold + FIXED_STEP_MS);
    expect(participant.board.active?.x).toBe(xBeforeHold - 1);
  });

  it('suspends an automatic event hold under the independent hidden pause reason', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    engine.state.participants[0]!.placedPieces = 15;
    engine.step(FIXED_STEP_MS);
    engine.step(200);
    const remaining = engine.state.globalEventHold?.remainingMs;
    engine.pause('hidden');
    engine.step(10_000);
    expect(engine.state.globalEventHold?.remainingMs).toBe(remaining);
    expect(engine.state.phase).toBe('paused');
    engine.resume('hidden');
    expect(engine.state.phase).toBe('playing');
    engine.step(remaining ?? 0);
    expect(engine.state.globalEventHold).toBeNull();
  });

  it('holds Final Push for two seconds, delays its first row, and coalesces a simultaneous level-up', () => {
    const engine = new MatchEngine(humanPair(), 83, 2);
    engine.step(COUNTDOWN_MS);
    engine.state.elapsedMs = engine.state.pressureStartMs - 1;
    engine.state.remainingMs = engine.state.durationMs - engine.state.elapsedMs;
    engine.state.participants[0]!.placedPieces = 15;
    const nextPressureAtMs = engine.state.nextPressureAtMs;

    engine.step(1);
    expect(engine.state.globalEventHold).toEqual({
      kind: 'final-push', remainingMs: FINAL_PUSH_PULSE_MS, durationMs: FINAL_PUSH_PULSE_MS, level: 1,
    });
    expect(engine.state.finalPushPulseMs).toBe(FINAL_PUSH_PULSE_MS);
    const elapsedAtHold = engine.state.elapsedMs;

    engine.step(FINAL_PUSH_PULSE_MS - 1);
    expect(engine.state.globalEventHold?.remainingMs).toBe(1);
    expect(engine.state.elapsedMs).toBe(elapsedAtHold);
    expect(engine.state.nextPressureAtMs).toBe(nextPressureAtMs);
    engine.step(1);
    expect(engine.state.globalEventHold).toBeNull();
    expect(engine.state.finalPushPulseMs).toBe(0);

    engine.step(nextPressureAtMs - elapsedAtHold - 1);
    expect(engine.state.pressureRows).toBe(0);
    engine.step(1);
    expect(engine.state.pressureRows).toBe(1);
  });

  it('keeps pressure and level-up presentation pulses independent when they coincide', () => {
    const engine = new MatchEngine(humanPair(), 83, 2);
    engine.step(COUNTDOWN_MS);
    engine.state.elapsedMs = engine.state.nextPressureAtMs - 1;
    engine.state.remainingMs = engine.state.durationMs - engine.state.elapsedMs;
    engine.state.participants[0]!.placedPieces = 15;
    engine.step(1);
    expect(engine.state.pressurePulseMs).toBeGreaterThan(0);
    expect(engine.state.levelUpEvent?.pulseMs).toBeGreaterThan(0);
  });

  it('pauses without advancing time and resumes from the same state', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    engine.step(500);
    engine.pause();
    const before = serializableState(engine.state);
    engine.step(10_000);
    expect(serializableState(engine.state)).toBe(before);
    engine.resume();
    engine.step(100);
    expect(engine.state.elapsedMs).toBe(600);
  });

  it('starts without pause reasons and restores countdown only after every reason clears', () => {
    const engine = createFixture();
    expect(engine.state.pauseReasons).toEqual([]);
    engine.step(900);
    const countdownMs = engine.state.countdownMs;
    engine.pause('manual');
    engine.pause('manual');
    engine.pause('hidden');
    expect(engine.state.pauseReasons).toEqual(['manual', 'hidden']);
    expect(engine.state.phase).toBe('paused');
    engine.step(5_000);
    expect(engine.state.countdownMs).toBe(countdownMs);
    engine.resume('manual');
    expect(engine.state.phase).toBe('paused');
    expect(engine.state.pauseReasons).toEqual(['hidden']);
    engine.resume('hidden');
    expect(engine.state.phase).toBe('countdown');
    expect(engine.state.pauseReasons).toEqual([]);
  });

  it('toggles manual pause in play without changing state and ignores results', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    engine.step(500);
    expect(engine.toggleManualPause()).toBe(true);
    expect(engine.state.phase).toBe('paused');
    const paused = serializableState(engine.state);
    engine.step(20_000);
    expect(serializableState(engine.state)).toBe(paused);
    expect(engine.toggleManualPause()).toBe(true);
    expect(engine.state.phase).toBe('playing');
    expect(engine.state.elapsedMs).toBe(500);
    engine.state.phase = 'results';
    expect(engine.toggleManualPause()).toBe(false);
    expect(engine.state.pauseReasons).toEqual([]);
  });

  it('freezes pending attacks, pressure, presentation effects, and timers during manual pause', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    engine.state.pendingConflict = {
      serial: 1,
      remainingWarningMs: 275,
      senders: [{ participantId: 'p1', rows: 3, recipientIds: ['p2'] }],
      incomingRows: { p2: 3 },
    };
    engine.state.pressurePulseMs = 400;
    engine.state.levelUpEvent = { serial: 1, level: 1, anomalyId: 'a1', pulseMs: 900 };
    engine.state.cleanupSerial = 1;
    engine.state.cleanupEvents = [{ serial: 1, participantId: 'p1', rows: 1, pulseMs: 600 }];
    engine.pause('manual');
    const before = serializableState(engine.state);
    engine.step(10_000, new Map([['p1', ['move-left']]]));
    expect(serializableState(engine.state)).toBe(before);
  });

  it('ends immediately when only one participant remains', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    prepareTopOut(engine.state.participants[1]!);
    engine.step(1000);
    expect(engine.state.phase).toBe('results');
    expect(engine.state.winnerIds).toEqual(['p1']);
    expect(engine.state.participants[0]?.placement).toBe(1);
    expect(engine.state.participants[1]?.placement).toBe(2);
    const frozen = engine.state.participants[1]!;
    const before = { score: frozen.score, pieces: frozen.placedPieces };
    engine.step(10_000);
    expect({ score: frozen.score, pieces: frozen.placedPieces }).toEqual(before);
  });

  it('shares first place for simultaneous final top-outs', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    engine.state.participants.forEach(prepareTopOut);
    engine.step(1000);
    expect(engine.state.phase).toBe('results');
    expect(engine.state.winnerIds).toHaveLength(2);
    expect(engine.state.participants.every((participant) => participant.placement === 1)).toBe(true);
  });

  it('keeps boards independent when one board is edited', () => {
    const engine = createFixture();
    engine.state.participants[0]!.board.grid[BOARD_HEIGHT - 1]![0] = 'I';
    expect(engine.state.participants[1]!.board.grid[BOARD_HEIGHT - 1]![0]).toBeNull();
  });

  it('prepares spawned pieces, extends rotation attempts up to the cap, and lets soft drop bypass it', () => {
    const tuning = cloneGameTuning();
    tuning.battleDifficulties.normal.startingGravityMs = 200;
    tuning.minimumGravityMs = 200;
    tuning.lockDelayMs = 100;
    const engine = new MatchEngine(humanPair(), 44, 5, {}, tuning);
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    const initialY = participant.board.active!.y;
    engine.step(399);
    expect(participant.board.active?.y).toBe(initialY);
    engine.step(1);
    engine.step(199);
    expect(participant.board.active?.y).toBe(initialY);
    engine.step(1);
    expect(participant.board.active?.y).toBe(initialY + 1);

    participant.board.active = activePiece('O', 0, 3, BOARD_HEIGHT - 2);
    participant.board.preparationRemainingMs = tuning.spawnPreparationMs;
    participant.board.preparationElapsedMs = 0;
    participant.board.lockElapsedMs = 0;
    const rotate = new Map([[participant.config.id, ['rotate-clockwise'] as const]]);
    engine.step(1, rotate);
    engine.step(1, rotate);
    engine.step(1, rotate);
    expect(participant.board.preparationElapsedMs + participant.board.preparationRemainingMs).toBe(tuning.spawnPreparationMaxMs);
    engine.step(1, rotate);
    expect(participant.board.preparationElapsedMs + participant.board.preparationRemainingMs).toBe(tuning.spawnPreparationMaxMs);

    const fast = new MatchEngine(humanPair(), 45, 5, {}, tuning);
    fast.step(COUNTDOWN_MS);
    const fastParticipant = fast.state.participants[0]!;
    const fastY = fastParticipant.board.active!.y;
    fast.step(50, new Map([[fastParticipant.config.id, ['soft-drop-on'] as const]]));
    expect(fastParticipant.board.preparationRemainingMs).toBe(0);
    expect(fastParticipant.board.active?.y).toBe(fastY + 1);

    participant.board.preparationRemainingMs = 0;
    participant.board.lockElapsedMs = 0;
    engine.step(tuning.lockDelayMs - 1);
    expect(participant.board.active).not.toBeNull();
    engine.step(1);
    expect(participant.board.spawnSerial).toBe(2);
    expect(participant.placedPieces).toBe(1);
  });

  it('keeps the preparation boundary deterministic across equivalent time partitions', () => {
    const tuning = cloneGameTuning();
    tuning.battleDifficulties.normal.startingGravityMs = 200;
    tuning.minimumGravityMs = 200;
    const oneStep = new MatchEngine(humanPair(), 46, 5, {}, tuning);
    const splitSteps = new MatchEngine(humanPair(), 46, 5, {}, tuning);
    oneStep.step(COUNTDOWN_MS);
    splitSteps.step(COUNTDOWN_MS);
    oneStep.step(600);
    splitSteps.step(400);
    splitSteps.step(200);
    expect(serializableState(oneStep.state)).toEqual(serializableState(splitSteps.state));
  });

  it('schedules pressure for two, five, and ten minute matches', () => {
    expect(new MatchEngine(humanPair(), 1, 2).state.nextPressureAtMs).toBe(70_000);
    expect(createFixture().state.nextPressureAtMs).toBe(220_000);
    expect(new MatchEngine(humanPair(), 1, 10).state.nextPressureAtMs).toBe(430_000);
  });

  it('applies pressure on active time and not while paused or at the deadline', () => {
    const engine = new MatchEngine(humanPair(), 2, 2);
    engine.step(COUNTDOWN_MS);
    engine.state.elapsedMs = engine.state.nextPressureAtMs - 1;
    engine.state.remainingMs = engine.state.durationMs - engine.state.elapsedMs;
    engine.pause();
    engine.step(5_000);
    expect(engine.state.pressureRows).toBe(0);
    engine.resume();
    engine.step(1);
    expect(engine.state.pressureRows).toBe(1);
    engine.state.nextPressureAtMs = engine.state.durationMs;
    engine.state.elapsedMs = engine.state.durationMs - 1;
    engine.step(1);
    expect(engine.state.pressureRows).toBe(1);
  });

  it('enters Final Push once on active time and freezes its transition while paused', () => {
    const engine = new MatchEngine(humanPair(), 84, 2);
    engine.step(COUNTDOWN_MS);
    engine.state.elapsedMs = engine.state.pressureStartMs - 1;
    engine.state.remainingMs = engine.state.durationMs - engine.state.elapsedMs;
    engine.pause();
    engine.step(1_000);
    expect(engine.state.finalPushActive).toBe(false);
    engine.resume();
    engine.step(1);
    expect(engine.state.finalPushActive).toBe(true);
    expect(engine.state.finalPushSerial).toBe(1);
    engine.step(1_000);
    expect(engine.state.finalPushSerial).toBe(1);
  });

  it('keeps the Final Push announcement visible for at least two active seconds', () => {
    const engine = new MatchEngine(humanPair(), 85, 2);
    engine.step(COUNTDOWN_MS);
    engine.state.elapsedMs = engine.state.pressureStartMs - 1;
    engine.state.remainingMs = engine.state.durationMs - engine.state.elapsedMs;
    engine.step(1);
    expect(engine.state.finalPushPulseMs).toBe(FINAL_PUSH_PULSE_MS);
    engine.step(FINAL_PUSH_PULSE_MS - 1);
    expect(engine.state.finalPushPulseMs).toBe(1);
    engine.pause();
    engine.step(500);
    expect(engine.state.finalPushPulseMs).toBe(1);
  });

  it('ends on timeout and ranks living scores above eliminated scores', () => {
    const configs = [...humanPair(), { id: 'ai', label: 'ИИ', controller: 'ai' as const, difficulty: 'easy' as const }];
    const engine = new MatchEngine(configs, 3, 2);
    engine.step(COUNTDOWN_MS);
    const [first, second, eliminated] = engine.state.participants;
    first!.score = 100;
    second!.score = 100;
    eliminated!.score = 800;
    eliminated!.board.alive = false;
    eliminated!.survivalMs = 40_000;
    eliminated!.eliminatedAtMs = 40_000;
    engine.state.nextPressureAtMs = engine.state.durationMs;
    engine.state.elapsedMs = engine.state.durationMs - 1;
    engine.step(1);
    expect(engine.state.endReason).toBe('timeout');
    expect(first!.placement).toBe(1);
    expect(second!.placement).toBe(1);
    expect(eliminated!.placement).toBe(3);
  });

  it('keeps a team alive until both teammates are out and uses half credit at timeout', () => {
    const configs = [
      { id: 'a', label: 'A', controller: 'human-1' as const }, { id: 'b', label: 'B', controller: 'human-2' as const },
      { id: 'c', label: 'C', controller: 'ai' as const, difficulty: 'easy' as const }, { id: 'd', label: 'D', controller: 'ai' as const, difficulty: 'easy' as const },
    ];
    const engine = new MatchEngine(configs, 444, 2, { matchVariant: 'teams' });
    engine.step(COUNTDOWN_MS);
    engine.state.participants[0]!.board.alive = false;
    engine.step(FIXED_STEP_MS);
    expect(engine.state.phase).toBe('playing');
    engine.state.participants[0]!.score = 200;
    engine.state.participants[1]!.score = 200;
    engine.state.participants[2]!.score = 250;
    engine.state.participants[3]!.score = 20;
    engine.state.elapsedMs = engine.state.durationMs;
    engine.step(FIXED_STEP_MS);
    expect(engine.state.winnerIds).toEqual(['a', 'b']);
  });

  it('does not jerk a piece down on a quick soft-drop tap', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    const before = participant.board.active?.y;
    engine.step(FIXED_STEP_MS, new Map([['p1', ['soft-drop-on', 'soft-drop-off']]]));
    expect(participant.board.active?.y).toBe(before);
  });

  it('does not freeze normal gravity when soft drop is tapped repeatedly', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    participant.board.gravityElapsedMs = 0;
    const before = participant.board.active?.y ?? 0;

    for (let tap = 0; tap < 20; tap += 1) {
      engine.step(50, new Map([['p1', ['soft-drop-on', 'soft-drop-off']]]));
    }

    expect(participant.board.active?.y).toBe(before + 1);
  });

  it('keeps the first soft-drop step delayed even when normal gravity has accumulated', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    participant.board.gravityElapsedMs = 700;
    const before = participant.board.active?.y ?? 0;

    engine.step(FIXED_STEP_MS, new Map([['p1', ['soft-drop-on']]]));

    expect(participant.board.active?.y).toBe(before);
    engine.step(SOFT_DROP_INTERVAL_MS - FIXED_STEP_MS);
    expect(participant.board.active?.y).toBe(before + 1);
  });

  it('keeps a held soft drop fast but visibly stepped', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    participant.board.gravityElapsedMs = 0;
    const before = participant.board.active?.y ?? 0;

    engine.step(1, new Map([['p1', ['soft-drop-on']]]));
    expect(participant.board.active?.y).toBe(before);

    engine.step(SOFT_DROP_INTERVAL_MS - 2);
    expect(participant.board.active?.y).toBe(before);

    engine.step(1);
    expect(participant.board.active?.y).toBe(before + 1);
    engine.step(SOFT_DROP_INTERVAL_MS);
    expect(participant.board.active?.y).toBe(before + 2);
  });

  it.each([
    ['slow', 150],
    ['fast', 110],
    ['very-fast', 80],
  ] as const)('delays the first %s soft-drop step for the full preset interval', (softDrop, intervalMs) => {
    const engine = new MatchEngine(humanPair(), 14, 5, { softDrop });
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    const before = participant.board.active?.y ?? 0;

    engine.step(1, new Map([['p1', ['soft-drop-on']]]));
    engine.step(intervalMs - 2);
    expect(participant.board.active?.y).toBe(before);
    engine.step(1);
    expect(participant.board.active?.y).toBe(before + 1);
  });

  it('freezes a held soft-drop cadence while paused', () => {
    const engine = createFixture();
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    const before = participant.board.active?.y ?? 0;
    engine.step(50, new Map([['p1', ['soft-drop-on']]]));
    engine.pause();
    engine.step(5_000);
    expect(participant.board.active?.y).toBe(before);
    engine.resume();
    engine.step(99);
    expect(participant.board.active?.y).toBe(before);
    engine.step(1);
    expect(participant.board.active?.y).toBe(before + 1);
  });

  it('creates repeatable fixture states', () => {
    expect(serializableState(createFixture().state)).toBe(serializableState(createFixture().state));
  });

  it('reproduces custom pacing from the same seed and immutable options', () => {
    const options = { battleDifficulty: 'sport', softDrop: 'very-fast', pressure: 'extended' } as const;
    const first = new MatchEngine(humanPair(), 2026, 7, options);
    const second = new MatchEngine(humanPair(), 2026, 7, options);
    first.step(COUNTDOWN_MS);
    second.step(COUNTDOWN_MS);
    for (let step = 0; step < 200; step += 1) {
      first.step(FIXED_STEP_MS);
      second.step(FIXED_STEP_MS);
    }
    expect(serializableState(first.state)).toBe(serializableState(second.state));
    expect(first.state.options).toEqual({
      ...options,
      battleTimeMode: 'timed',
      conflictEnabled: true,
      matchVariant: 'free-for-all',
      conflictTargeting: 'all-opponents',
      startingGravityMs: 750,
      accelerationPercent: 10,
      piecesPerLevel: 10,
      softDropIntervalMs: 80,
      tuning: null,
    });
  });
});
