import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, type MatchVariant, type ParticipantState } from '../src/domain/types';
import { DEFAULT_GAME_TUNING } from '../src/domain/gameTuning';
import { COUNTDOWN_MS, FIXED_STEP_MS, LOCK_DELAY_MS, MatchEngine } from '../src/simulation/match';
import { activePiece } from '../src/simulation/tetrominoes';
import { aiQuartet, humanPair } from './fixtures';
import { globalMatchEvent } from '../src/ui/matchEventPresentation';
import { matchClockPresentation } from '../src/ui/format';

function battle(variant: MatchVariant = 'free-for-all', four = false): MatchEngine {
  const engine = new MatchEngine(variant === 'teams' || four ? aiQuartet() : humanPair(), 77, 2,
    { battleTimeMode: 'until-victory', matchVariant: variant });
  engine.step(COUNTDOWN_MS);
  return engine;
}

function topOut(participant: ParticipantState): void {
  for (let y = 0; y < 4; y += 1) for (let x = 3; x <= 6; x += 1) participant.board.grid[y]![x] = 'J';
  participant.board.active = activePiece('O', 0, 3, BOARD_HEIGHT - 2);
  participant.board.gravityElapsedMs = 1000;
}

describe('Battle until victory', () => {
  it.each(['free-for-all', 'teams'] as const)('keeps %s alive past ten minutes regardless of score', (variant) => {
    const engine = battle(variant);
    engine.state.participants[0]!.score = 99999;
    engine.state.elapsedMs = 600000;
    engine.state.nextPressureAtMs = 605000;
    engine.state.finalPushActive = true;
    engine.step(1);
    expect(engine.state.phase).toBe('playing');
    expect(engine.state.elapsedMs).toBe(600001);
    expect(engine.state.durationMs).toBe(Infinity);
    expect(engine.state.remainingMs).toBe(Infinity);
    expect(engine.state.isSurvival).toBe(false);
    expect(engine.state.options.conflictEnabled).toBe(true);
    expect(engine.state.winnerIds).toEqual([]);
    expect(matchClockPresentation(!Number.isFinite(engine.state.durationMs), engine.state.elapsedMs, engine.state.remainingMs).milliseconds).toBe(600001);
  });

  it.each(['free-for-all', 'teams'] as const)('uses the exact Survival pressure cadence for %s and restores checkpoints', (variant) => {
    const engine = battle(variant);
    const pulseTimes = [180000, 195000, 209000, 222000, 234000, 245000, 255000, 264000, 272000, 279000, 285000, 290000, 295000, 300000];
    for (const [index, time] of pulseTimes.entries()) {
      if (engine.state.globalEventHold) engine.step(engine.state.globalEventHold.remainingMs);
      for (const participant of engine.state.participants) participant.board.grid.forEach((row) => row.fill(null));
      engine.state.elapsedMs = time - 2;
      engine.step(1);
      expect(engine.state.pressureRows).toBe(index);
      engine.step(1);
      expect(engine.state.pressureRows).toBe(index + 1);
      expect(engine.state.nextPressureAtMs).toBe(time + Math.max(5000, 15000 - index * 1000));
      for (const participant of engine.state.participants) expect(engine.state.attackQueues[participant.config.id]?.[0]?.reason).toBe('pressure');
      if (index === 0) expect(globalMatchEvent(engine.state, DEFAULT_GAME_TUNING.messages)).toMatchObject({title:'Фаза давления'});
      if(engine.state.globalEventHold) engine.step(engine.state.globalEventHold.remainingMs);
      engine.step(3000);engine.step(600);
      for (const participant of engine.state.participants) expect(participant.board.grid.at(-1)?.every((cell) => cell === 'garbage')).toBe(true);

    }
    const restored = MatchEngine.restore(JSON.parse(JSON.stringify(engine.checkpoint())));
    engine.step(1);
    restored.step(1);
    expect(restored.state).toEqual(engine.state);
  });

  it.each(['manual', 'hidden'] as const)('freezes time and grey pressure during %s pause', (reason) => {
    const engine = battle();
    engine.state.elapsedMs = 179999;
    engine.pause(reason);
    engine.step(60000);
    expect(engine.state.elapsedMs).toBe(179999);
    expect(engine.state.pressureRows).toBe(0);
    engine.resume(reason);
    engine.state.participants[0]!.shieldCount = 1;
    engine.step(1);
    expect(engine.state.pressureRows).toBe(1);
    expect(engine.state.nextPressureAtMs).toBe(195000);
    expect(engine.state.participants[0]!.shieldCount).toBe(1);
    expect(engine.state.participants[0]!.board.grid.at(-1)?.every((cell) => cell === 'garbage')).toBe(false);
    const time = engine.state.elapsedMs;
    engine.step(engine.state.globalEventHold!.remainingMs);
    expect(engine.state.elapsedMs).toBe(time);
    engine.step(3000);expect(engine.state.participants[0]!.shieldCount).toBe(0);
  });

  it('retains shared Battle levels and anomalies rather than independent Survival progression', () => {
    const engine = battle();
    engine.state.participants[0]!.placedPieces = 15;
    engine.step(1);
    expect(engine.state.participants.map((participant) => participant.gravityLevel)).toEqual([1, 1]);
    expect(engine.state.participants.every((participant) => participant.board.pendingAnomalies.length === 1)).toBe(true);
    expect(engine.state.anomalyTransition?.phase).toBe('burning');
  });

  it('retains attacks and waits for their pending impact before declaring victory', () => {
    const engine = battle();
    const participant = engine.state.participants[0]!;
    for (let y = BOARD_HEIGHT - 2; y < BOARD_HEIGHT; y += 1) {
      participant.board.grid[y]!.fill('J');
      participant.board.grid[y]![4] = null;
      participant.board.grid[y]![5] = null;
    }
    participant.board.active = activePiece('O', 0, 3, BOARD_HEIGHT - 2);
    participant.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;
    engine.step(FIXED_STEP_MS);
    while (engine.state.clearPresentations.length) engine.step(engine.state.clearPresentations[0]!.remainingMs);
    expect(engine.state.pendingConflict?.incomingRows.p2).toBe(1);
    engine.eliminate('p1');
    expect(engine.state.phase).toBe('playing');
    engine.step(engine.state.pendingConflict!.remainingWarningMs + 1);
    engine.step(600);
    expect(engine.state.winnerIds).toEqual(['p2']);
  });

  it('awards the sole survivor victory even when an eliminated opponent has more points', () => {
    const engine = battle();
    engine.state.participants[0]!.score = 99999;
    engine.eliminate('p1');
    expect(engine.state.winnerIds).toEqual(['p2']);
    expect(engine.state.endReason).toBe('survival');
  });

  it('allows one team survivor to beat the higher scoring opposing team', () => {
    const engine = battle('teams');
    engine.state.participants[0]!.score = 99999;
    engine.eliminate('ai-1');
    engine.eliminate('ai-3');
    expect(engine.state.phase).toBe('playing');
    engine.eliminate('ai-2');
    expect(engine.state.winnerIds).toEqual(['ai-3', 'ai-4']);
  });

  it('uses score only among simultaneous final FFA opponents, excluding earlier high scorers', () => {
    const engine = battle('free-for-all', true);
    engine.state.participants[0]!.score = 99999;
    engine.eliminate('ai-1');
    engine.eliminate('ai-2');
    engine.step(1);
    engine.state.participants[2]!.score = 100;
    engine.state.participants[3]!.score = 800;
    engine.state.participants.slice(2).forEach(topOut);
    engine.step(1000);
    expect(engine.state.winnerIds).toEqual(['ai-4']);
    expect(engine.state.participants.map((participant) => participant.placement)).toEqual([3, 3, 2, 1]);
    expect(engine.state.endReason).toBe('simultaneous-elimination');
  });

  it('uses total team scores only after simultaneous final team elimination', () => {
    const engine = battle('teams');
    engine.state.participants[0]!.score = 800;
    engine.state.participants[2]!.score = 500;
    engine.state.participants[3]!.score = 500;
    engine.state.participants.forEach(topOut);
    engine.step(1000);
    expect(engine.state.winnerIds).toEqual(['ai-3', 'ai-4']);
    expect(engine.state.endReason).toBe('simultaneous-elimination');
  });

  it.each(['free-for-all', 'teams'] as const)('keeps the last %s side as winner if a deferred attack eliminates it later', (variant) => {
    const engine = battle(variant);
    const participants = engine.state.participants;
    const last = participants.at(-1)!;
    participants[0]!.score = 99999;
    engine.state.pendingConflict = { serial: 1, remainingWarningMs: 500,
      senders: [{ participantId: participants[0]!.config.id, rows: 1, recipientIds: [last.config.id] }],
      incomingRows: { [last.config.id]: 1 } };
    engine.enqueueBoardAttack(last.config.id,1,'conflict',participants[0]!.config.id);
    engine.state.attackQueues[last.config.id]![0]!.remainingMs=500;
    participants.slice(0, -1).forEach((participant) => engine.eliminate(participant.config.id));
    expect(engine.state.phase).toBe('playing');
    last.board.grid[0]![0] = 'J';
    engine.step(1000);
    expect(engine.state.winnerIds).toEqual(variant === 'teams' ? ['ai-3', 'ai-4'] : ['p2']);
    expect(engine.state.endReason).toBe('survival');
  });

  it.each(['free-for-all', 'teams'] as const)('retains shared draws for equal final scores in %s', (variant) => {
    const engine = battle(variant);
    engine.state.participants.forEach(topOut);
    engine.step(1000);
    expect(engine.state.winnerIds).toHaveLength(engine.state.participants.length);
  });

  it('ignores a saved until-victory policy in local and network Survival', () => {
    for (const execution of ['local', 'network'] as const) {
      const engine = new MatchEngine(humanPair(), 1, 5, { battleTimeMode: 'until-victory' }, null, true, execution);
      expect(engine.state.options.battleTimeMode).toBe('timed');
      expect(engine.state.options.conflictEnabled).toBe(false);
      expect(engine.state.isSurvival).toBe(true);
    }
  });
});
