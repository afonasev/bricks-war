import { describe, expect, it } from 'vitest';
import { AudioEventTracker, gameTempo } from '../src/audio/audioEvents';
import type { ParticipantConfig } from '../src/domain/types';
import { generateAnomaly } from '../src/simulation/anomaly';
import { MatchEngine } from '../src/simulation/match';

const configs: ParticipantConfig[] = [
  { id: 'p1', label: 'Игрок 1', controller: 'human-1' },
  { id: 'p2', label: 'Игрок 2', controller: 'human-2' },
];

describe('game audio events', () => {
  it('raises soundtrack tempo with actual gravity speed and caps it', () => {
    expect(gameTempo(800, 800)).toBe(96);
    expect(gameTempo(700, 800)).toBeGreaterThan(gameTempo(800, 800));
    expect(gameTempo(400, 800)).toBeGreaterThan(gameTempo(600, 800));
    expect(gameTempo(10, 800)).toBe(160);
    expect(gameTempo(800, 800, true)).toBeGreaterThan(gameTempo(800, 800));
    expect(gameTempo(10, 800, true)).toBe(176);
  });

  it('emits preparation, start, and final ten-second ticks once per second', () => {
    const engine = new MatchEngine(configs, 12, 2);
    const tracker = new AudioEventTracker();
    expect(tracker.sync(engine.state)).toContainEqual({ type: 'countdown', second: 3 });
    engine.state.countdownMs = 1_900;
    expect(tracker.sync(engine.state)).toContainEqual({ type: 'countdown', second: 2 });
    engine.state.phase = 'playing';
    engine.state.remainingMs = 59_000;
    expect(tracker.sync(engine.state)).toContainEqual({ type: 'round-start' });
    const ticks: number[] = [];
    for (let second = 10; second >= 1; second -= 1) {
      engine.state.remainingMs = second * 1000 - 100;
      for (const event of tracker.sync(engine.state)) {
        if (event.type === 'final-tick') ticks.push(event.second);
      }
    }
    expect(ticks).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(tracker.sync(engine.state).filter((event) => event.type === 'final-tick')).toEqual([]);
  });

  it('does not replay countdown or final ticks when pause resumes', () => {
    const countdownEngine = new MatchEngine(configs, 13, 2);
    const countdownTracker = new AudioEventTracker();
    countdownTracker.sync(countdownEngine.state);
    countdownEngine.pause('manual');
    expect(countdownTracker.sync(countdownEngine.state)).toEqual([]);
    countdownEngine.resume('manual');
    expect(countdownTracker.sync(countdownEngine.state)).toEqual([]);

    const finalEngine = new MatchEngine(configs, 14, 2);
    finalEngine.step(3_000);
    finalEngine.state.remainingMs = 9_500;
    const finalTracker = new AudioEventTracker();
    finalTracker.sync(finalEngine.state);
    finalEngine.pause('manual');
    expect(finalTracker.sync(finalEngine.state)).toEqual([]);
    finalEngine.resume('manual');
    expect(finalTracker.sync(finalEngine.state)).toEqual([]);
  });

  it('distinguishes rotation, lock, landed clear impact, anomaly spawn, pressure, and elimination', () => {
    const engine = new MatchEngine(configs, 21, 2);
    engine.state.phase = 'playing';
    const tracker = new AudioEventTracker();
    tracker.sync(engine.state);
    const participant = engine.state.participants[0]!;
    if (!participant.board.active) throw new Error('Expected an active piece');
    participant.board.active.rotation = 1;
    expect(tracker.sync(engine.state)).toContainEqual({ type: 'rotate', pan: -0.72 });
    participant.placedPieces += 1;
    participant.score += 300;
    engine.state.clearImpactSerial = 1;
    engine.state.clearImpactEvents = [{ serial: 1, participantId: 'p1', lines: 2 }];
    participant.board.spawnSerial += 1;
    participant.board.active.definition = generateAnomaly(21, 1);
    participant.board.alive = false;
    engine.state.pressureRows = 1;
    engine.state.levelUpEvent = { serial: 1, level: 1, anomalyId: 'anomaly-1', pulseMs: 1000 };
    engine.state.gravityLevel = 1;
    engine.state.anomalyArrivalSerial = 1;

    const eventTypes = tracker.sync(engine.state).map((event) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      'lock', 'clear-impact', 'anomaly-spawn', 'eliminated',
    ]));
    expect(tracker.sync(engine.state).filter((event) => event.type === 'clear-impact')).toEqual([]);
  });

  it('waits for actual Survival anomaly spawn before sounding the alarm', () => {
    const engine = new MatchEngine(configs, 27, 5, {}, null, true);
    engine.step(3_000);
    const tracker = new AudioEventTracker();
    tracker.sync(engine.state);
    engine.state.participants[1]!.placedPieces = 15;
    engine.step(1);

    const queued = tracker.sync(engine.state);
    expect(queued.some((e) => e.type === 'level-up' || e.type === 'anomaly-spawn')).toBe(false);
    const p = engine.state.participants[1]!;
    p.board.active!.definition = generateAnomaly(engine.state.seed, 1);p.board.spawnSerial += 1;
    expect(tracker.sync(engine.state)).toContainEqual({ type: 'anomaly-spawn', pan: 0.72 });
  });

  it('emits conflict launch, impact, and cleanup once from their serials', () => {
    const engine = new MatchEngine(configs, 31, 2);
    engine.state.phase = 'playing';
    const tracker = new AudioEventTracker();
    tracker.sync(engine.state);
    engine.state.pendingConflict = {
      serial: 1,
      remainingWarningMs: 350,
      senders: [{ participantId: 'p1', rows: 4, recipientIds: ['p2'] }],
      incomingRows: { p2: 4 },
    };
    engine.state.attackSerial = 1;
    engine.state.attackLaunchEvents = [{serial:1,participantId:'p1',rows:4,recipientIds:['p2'],remainingMs:1500}];
    expect(tracker.sync(engine.state)).toContainEqual({ type: 'conflict-launch', rows: 4, pan: -0.72 });
    expect(tracker.sync(engine.state).filter((event) => event.type === 'conflict-launch')).toEqual([]);
    engine.state.pendingConflict = null;
    engine.state.conflictImpactEvent = { serial: 1, incomingRows: { p2: 4 }, maxRows: 4, pulseMs: 700 };
    expect(tracker.sync(engine.state)).toContainEqual({ type: 'conflict-impact', rows: 4, pan: 0.72 });
    engine.state.cleanupSerial = 1;
    engine.state.cleanupEvents = [{ serial: 1, participantId: 'p1', rows: 2, pulseMs: 800 }];
    expect(tracker.sync(engine.state)).toContainEqual({ type: 'cleanup', rows: 2, pan: -0.72, amplified: false });
    expect(tracker.sync(engine.state).filter((event) => ['conflict-impact', 'cleanup'].includes(event.type))).toEqual([]);
  });

  it('emits distinct shield, defense, and Final Push events once', () => {
    const engine = new MatchEngine(configs, 32, 2);
    engine.state.phase = 'playing';
    const tracker = new AudioEventTracker();
    tracker.sync(engine.state);
    engine.state.shieldChargeSerial = 2;
    engine.state.shieldChargeEvents = [
      { serial: 1, participantId: 'p1', kind: 'half', pulseMs: 700 },
      { serial: 2, participantId: 'p2', kind: 'full', pulseMs: 700 },
    ];
    engine.state.finalPushSerial = 1;
    engine.state.finalPushActive = true;
    engine.state.conflictImpactEvent = {
      serial: 1, incomingRows: {}, maxRows: 0, pulseMs: 700, defendedRecipientIds: ['p1'], shieldedRecipientIds: ['p2'],
    };
    engine.state.attackResolutionSerial=1;engine.state.attackResolutionEvents=[{serial:1,participantId:'p1',defended:true}];
    engine.state.shieldInventorySerial = 1;
    engine.state.shieldInventoryEvents = [{serial:1, participantId:'p2', kind:'burn', reason:'conflict', firstSlot:0, count:2, pulseMs:1000}];
    const types = tracker.sync(engine.state).map((event) => event.type);
    expect(types).toEqual(expect.arrayContaining(['shield-full-charge', 'final-push', 'active-defense', 'shield-block']));
    expect(types).not.toContain('shield-half-charge');
    expect(tracker.sync(engine.state)).toEqual([]);
  });
});
