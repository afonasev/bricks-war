import { describe, expect, it } from 'vitest';
import { MatchEngine, COUNTDOWN_MS } from '../src/simulation/match';
import { humanPair } from './fixtures';
import { shieldInventoryMarkup } from '../src/ui/shieldInventory';
import { conflictPresentationForParticipant } from '../src/rendering/conflictPresentation';
import { participantMatchEvent } from '../src/ui/matchEventPresentation';
import { DEFAULT_GAME_TUNING } from '../src/domain/gameTuning';
import { AudioEventTracker } from '../src/audio/audioEvents';

describe('whole shield inventory presentation', () => {
  it('shows every consumed slot without losing same-frame gain and burn', () => {
    const engine = new MatchEngine(humanPair(), 1);
    const p = engine.state.participants[0]!;
    p.shieldCount = 1;
    engine.state.shieldInventoryEvents = [
      {serial:1, participantId:'p1', kind:'gain', reason:'clear', firstSlot:2, count:1, pulseMs:450},
      {serial:2, participantId:'p1', kind:'burn', reason:'conflict', firstSlot:1, count:2, pulseMs:1000},
    ];
    const markup = shieldInventoryMarkup(p, engine.state);
    expect(markup.match(/is-burning/g)).toHaveLength(2);
    expect(markup).toContain('is-gain');
    expect(markup).toContain('Щиты: 1/3');
    expect(markup).not.toContain('is-partial');
    engine.state.shieldInventoryEvents = [];
    expect(shieldInventoryMarkup(p, engine.state).match(/is-full/g)).toHaveLength(1);
  });

  it('does not present partial shield absorption as complete protection', () => {
    const engine = new MatchEngine(humanPair(), 2); engine.step(COUNTDOWN_MS + 1200);
    engine.state.participants[0]!.shieldCount = 1;
    engine.state.pendingConflict = {serial:1, remainingWarningMs:200, senders:[], incomingRows:{p1:3}};
    expect(conflictPresentationForParticipant(engine.state, 'p1').shieldReady).toBe(false);
    engine.state.pendingConflict = null;
    engine.state.conflictImpactEvent = {serial:1, incomingRows:{p1:2}, maxRows:2, pulseMs:1000, shieldedRecipientIds:['p1']};
    expect(conflictPresentationForParticipant(engine.state, 'p1').shieldBlocked).toBe(false);
    expect(participantMatchEvent(engine.state, 'p1', DEFAULT_GAME_TUNING.messages, [])?.kind).not.toBe('shield-block');
    engine.state.conflictImpactEvent.incomingRows = {};
    expect(conflictPresentationForParticipant(engine.state, 'p1').shieldBlocked).toBe(true);
  });

  it('pressure consumes and signals one shield, survives checkpoint and pauses its event', () => {
    const engine = new MatchEngine(humanPair(), 3, 5, {}, null, true); engine.step(COUNTDOWN_MS);
    const p = engine.state.participants[0]!; p.shieldCount = 2; p.shieldReady = true; p.lineClearStreak = 4;
    const tracker = new AudioEventTracker(); tracker.sync(engine.state);
    engine.state.nextPressureAtMs = engine.state.elapsedMs + 1; engine.step(2);
    expect(p.shieldCount).toBe(2); expect(engine.state.attackQueues.p1![0]!.reason).toBe('pressure');
    engine.step(3000);
    expect(p.shieldCount).toBe(1); expect(p.lineClearStreak).toBe(4);
    expect(engine.state.shieldInventoryEvents[0]).toMatchObject({reason:'pressure', count:1, firstSlot:1});
    expect(tracker.sync(engine.state).filter(e => e.type === 'shield-block')).toHaveLength(1);
    expect(tracker.sync(engine.state)).toEqual([]);
    expect(MatchEngine.restore(engine.checkpoint()).checkpoint()).toEqual(engine.checkpoint());
    engine.pause('manual'); const remaining = engine.state.shieldInventoryEvents[0]!.pulseMs;
    engine.step(2000); expect(engine.state.shieldInventoryEvents[0]!.pulseMs).toBe(remaining);
  });
});
