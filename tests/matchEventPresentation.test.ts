import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_TUNING } from '../src/domain/gameTuning';
import { MatchEngine, COUNTDOWN_MS, FINAL_PUSH_PULSE_MS, FIXED_STEP_MS } from '../src/simulation/match';
import {
  MATCH_EVENT_DEFINITIONS,
  formatParticipantEventMarkup,
  globalMatchEvent,
  matchEventIconMarkup,
  matchEventPlaqueMarkup,
  participantMatchEvent,
} from '../src/ui/matchEventPresentation';
import { humanPair } from './fixtures';

describe('match event presentation', () => {
  it('defines every shipped event with deterministic scope metadata and distinct icon families', () => {
    expect(Object.keys(MATCH_EVENT_DEFINITIONS)).toEqual([
      'round-start', 'level-up', 'final-push', 'incoming-attack', 'active-defense', 'shield-block',
      'shield-half', 'shield-full', 'anomaly-burn', 'cleanup',
    ]);
    expect(MATCH_EVENT_DEFINITIONS['final-push'].priority).toBeGreaterThan(MATCH_EVENT_DEFINITIONS['level-up'].priority);
    expect(new Set(Object.values(MATCH_EVENT_DEFINITIONS).map((entry) => entry.icon)).size).toBeGreaterThanOrEqual(7);
    for (const definition of Object.values(MATCH_EVENT_DEFINITIONS)) {
      expect(matchEventIconMarkup(definition.icon)).toContain(`data-icon="${definition.icon}"`);
      expect(matchEventIconMarkup(definition.icon)).toContain('aria-hidden="true"');
    }
  });

  it('keeps round start alive for its bounded engine pulse', () => {
    const engine = new MatchEngine(humanPair(), 1);
    engine.step(COUNTDOWN_MS);
    expect(globalMatchEvent(engine.state, DEFAULT_GAME_TUNING.messages)).toMatchObject({ kind: 'round-start', hold: 'none' });
    engine.step(1_100);
    expect(globalMatchEvent(engine.state, DEFAULT_GAME_TUNING.messages)).toBeNull();
  });

  it('retains Final Push without adding an anomaly-arrival notice', () => {
    const engine = new MatchEngine(humanPair(), 4, 2);
    engine.step(COUNTDOWN_MS);
    engine.state.elapsedMs = engine.state.pressureStartMs - 1;
    engine.state.remainingMs = engine.state.durationMs - engine.state.elapsedMs;
    engine.state.participants[0]!.placedPieces = 15;
    engine.step(1);
    const event = globalMatchEvent(engine.state, DEFAULT_GAME_TUNING.messages);
    expect(event).toMatchObject({ kind: 'final-push', lifetimeMs: FINAL_PUSH_PULSE_MS, hold: 'global' });
    expect(event?.detail).not.toContain('Уровень');
  });

  it('presents the Survival final push with pressure-phase copy', () => {
    const engine = new MatchEngine(humanPair(), 4, 2, {}, null, true);
    engine.step(COUNTDOWN_MS);
    engine.state.elapsedMs = engine.state.pressureStartMs - 1;
    engine.state.remainingMs = engine.state.durationMs - engine.state.elapsedMs;
    engine.step(1);

    expect(globalMatchEvent(engine.state, DEFAULT_GAME_TUNING.messages)).toMatchObject({
      kind: 'final-push',
      title: 'Фаза давления',
      detail: 'Серый ряд каждые 15 → 5 секунд',
    });
  });

  it('prioritizes local outcomes and preserves safe attack formatting values', () => {
    const engine = new MatchEngine(humanPair(), 7);
    engine.step(COUNTDOWN_MS);
    engine.state.pendingConflict = {
      serial: 1,
      remainingWarningMs: 500,
      senders: [{ participantId: 'p1', rows: 3, recipientIds: ['p2'] }],
      incomingRows: { p2: 3 },
    };
    expect(participantMatchEvent(engine.state, 'p2', DEFAULT_GAME_TUNING.messages, ['Аня'])).toMatchObject({
      kind: 'incoming-attack', title: 'Аня ⚔ 3',
    });
    engine.state.conflictImpactEvent = {
      serial: 1, incomingRows: {}, maxRows: 0, pulseMs: 700, shieldedRecipientIds: ['p2'],
    };
    engine.state.pendingConflict = null;
    expect(participantMatchEvent(engine.state, 'p2', DEFAULT_GAME_TUNING.messages, ['Аня'])).toBeNull();
    engine.step(FIXED_STEP_MS);
  });

  it('ends the attack notice at the three-second warning boundary even while impact feedback remains', () => {
    const engine = new MatchEngine(humanPair(), 7);
    engine.step(COUNTDOWN_MS);
    engine.state.pendingConflict = {
      serial: 1, remainingWarningMs: 3_000,
      senders: [{ participantId: 'p1', rows: 3, recipientIds: ['p2'] }], incomingRows: {p2: 3},
    };
    expect(participantMatchEvent(engine.state, 'p2', DEFAULT_GAME_TUNING.messages, ['Аня'])).toMatchObject({kind: 'incoming-attack', lifetimeMs: 3_000});
    engine.step(2_999);
    expect(participantMatchEvent(engine.state, 'p2', DEFAULT_GAME_TUNING.messages, ['Аня'])).toMatchObject({kind: 'incoming-attack', lifetimeMs: 1});
    engine.step(1);
    expect(engine.state.conflictImpactEvent?.pulseMs).toBeGreaterThan(0);
    expect(participantMatchEvent(engine.state, 'p2', DEFAULT_GAME_TUNING.messages, ['Аня'])).toBeNull();
  });

  it('removes Survival level-up notices from every participant', () => {
    const engine = new MatchEngine(humanPair(), 71, 5, {}, null, true);
    engine.step(COUNTDOWN_MS);
    engine.step(1_100);
    engine.state.participants[0]!.placedPieces = 15;
    engine.step(FIXED_STEP_MS);

    expect(globalMatchEvent(engine.state, DEFAULT_GAME_TUNING.messages)).toBeNull();
    expect(participantMatchEvent(engine.state, 'p1', DEFAULT_GAME_TUNING.messages, [])).toBeNull();
    expect(participantMatchEvent(engine.state, 'p2', DEFAULT_GAME_TUNING.messages, [])).toBeNull();
  });

  it('maps defense, shield charge, anomaly burn, and cleanup to distinct primary outcomes', () => {
    const engine = new MatchEngine(humanPair(), 8);
    engine.step(COUNTDOWN_MS);
    engine.state.conflictImpactEvent = {
      serial: 2, incomingRows: {}, maxRows: 0, pulseMs: 700, defendedRecipientIds: ['p2'],
    };
    expect(participantMatchEvent(engine.state, 'p2', DEFAULT_GAME_TUNING.messages, [])).toBeNull();

    engine.state.conflictImpactEvent = null;
    engine.state.shieldChargeEvents = [{ serial: 3, participantId: 'p2', kind: 'half', pulseMs: 1_000 }];
    expect(participantMatchEvent(engine.state, 'p2', DEFAULT_GAME_TUNING.messages, [])).toBeNull();
    engine.state.shieldChargeEvents = [{ serial: 4, participantId: 'p2', kind: 'full', pulseMs: 900 }];
    expect(participantMatchEvent(engine.state, 'p2', DEFAULT_GAME_TUNING.messages, [])).toBeNull();

    engine.state.cleanupEvents = [{ serial: 2, participantId: 'p2', rows: 3, pulseMs: 650 }];
    expect(participantMatchEvent(engine.state, 'p2', DEFAULT_GAME_TUNING.messages, [])).toMatchObject({kind:'cleanup'});
    engine.state.shieldChargeEvents = [];
    expect(participantMatchEvent(engine.state, 'p2', DEFAULT_GAME_TUNING.messages, [])).toMatchObject({ kind: 'cleanup', lifetimeMs: 650 });

    engine.state.anomalyBurnEvents = [{ serial: 2, participantId: 'p2', rows: [[null, 'garbage']], pulseMs: 500 }];
    expect(participantMatchEvent(engine.state, 'p2', DEFAULT_GAME_TUNING.messages, [])).toMatchObject({kind:'cleanup'});
  });

  it('renders the shared plaque anatomy for every event family', () => {
    for (const [kind, definition] of Object.entries(MATCH_EVENT_DEFINITIONS)) {
      const markup = matchEventPlaqueMarkup({
        kind: kind as keyof typeof MATCH_EVENT_DEFINITIONS,
        scope: 'global',
        title: `Событие ${kind}`,
        detail: 'Пояснение',
        ...definition,
      });
      expect(markup).toContain('match-event-icon-tile');
      expect(markup).toContain(`data-icon="${definition.icon}"`);
      expect(markup).toContain('<strong>');
      expect(markup).toContain('<small>Пояснение</small>');
    }
  });

  it('escapes editable copy and preserves only the sender accent wrapper', () => {
    const markup = formatParticipantEventMarkup(
      'Вас атакует {senders} +{rows} {unknown}',
      { senders: '<img src=x onerror=alert(1)>', rows: 4 },
    );
    expect(markup).toContain('<span class="player-event-sender">&lt;img src=x onerror=alert(1)&gt;</span>');
    expect(markup).toContain('+4 {unknown}');
    expect(markup).not.toContain('<img');
    expect(matchEventPlaqueMarkup({
      kind: 'round-start', scope: 'global', title: '<b>Старт</b>', detail: 'A & B',
      ...MATCH_EVENT_DEFINITIONS['round-start'],
    })).toContain('&lt;b&gt;Старт&lt;/b&gt;');
  });
});
