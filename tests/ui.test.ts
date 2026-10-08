import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MASTER_VOLUME,
  GameAudio,
  MUSIC_LOOKAHEAD_SECONDS,
  MUSIC_SCHEDULER_MS,
  conflictSoundProfile,
  masterGainForVolume,
} from '../src/audio/GameAudio';
import { conflictPresentationForParticipant, conflictTier } from '../src/rendering/conflictPresentation';
import { MatchEngine } from '../src/simulation/match';
import { formatClock, formatDuration, formatPieces, matchClockPresentation } from '../src/ui/format';
import { levelUpMessage } from '../src/ui/levelUpAudio';
import { startsMutedForPlaytest } from '../src/ui/playtestParams';

describe('results formatting', () => {
  it('formats survival time as minutes, seconds, and tenths', () => {
    expect(formatDuration(0)).toBe('00:00.0');
    expect(formatDuration(65_432)).toBe('01:05.4');
  });

  it('formats a remaining-time clock by rounding up partial seconds', () => {
    expect(formatClock(300_000)).toBe('05:00');
    expect(formatClock(59_001)).toBe('01:00');
    expect(formatClock(0)).toBe('00:00');
  });

  it('selects elapsed or remaining arena clock presentation by mode', () => {
    expect(matchClockPresentation(true, 12_000, 288_000)).toEqual({
      milliseconds: 12_000,
      label: 'ПРОШЛО ВРЕМЕНИ',
      ariaLabel: 'Прошедшее время матча',
    });
    expect(matchClockPresentation(false, 12_000, 288_000)).toEqual({
      milliseconds: 288_000,
      label: 'ОСТАЛОСЬ ВРЕМЕНИ',
      ariaLabel: 'Оставшееся время матча',
    });
  });

  it('uses readable Russian piece-count forms', () => {
    expect([formatPieces(1), formatPieces(2), formatPieces(5), formatPieces(11), formatPieces(21)]).toEqual([
      '1 фигура', '2 фигуры', '5 фигур', '11 фигур', '21 фигура',
    ]);
  });

  it('formats the compact level-up anomaly announcement', () => {
    expect(levelUpMessage(1)).toBe('LEVEL 2 · ANOMALY NEXT');
  });

  it('keeps playing when WebAudio is unavailable', () => {
    const audio = new GameAudio();
    expect(() => audio.unlock()).not.toThrow();
    expect(() => audio.enterMenu()).not.toThrow();
    expect(() => audio.playUiSelect()).not.toThrow();
    expect(() => audio.playUiFeedback('back')).not.toThrow();
  });

  it('keeps the menu melody clock continuous across menu-page navigation', () => {
    const audio = new GameAudio();
    const internals = audio as unknown as { mode: string; musicStep: number; nextMusicStepAt: number };
    internals.mode = 'menu';
    internals.musicStep = 11;
    internals.nextMusicStepAt = 42.5;
    audio.enterMenu();
    audio.enterMenu();
    expect([internals.musicStep, internals.nextMusicStepAt]).toEqual([11, 42.5]);
  });

  it('restarts the music clock only when the music direction actually changes', () => {
    const audio = new GameAudio();
    const internals = audio as unknown as { context: AudioContext; musicStep: number; nextMusicStepAt: number };
    internals.context = { currentTime: 7 } as AudioContext;
    internals.musicStep = 9;
    internals.nextMusicStepAt = 12;
    audio.setDirections('neon-workshop', 'construction');
    expect([internals.musicStep, internals.nextMusicStepAt]).toEqual([9, 12]);
    audio.setDirections('brickbeat', 'construction');
    expect([internals.musicStep, internals.nextMusicStepAt]).toEqual([0, 7.045]);
  });

  it('holds back the game melody during countdown and starts a match intro at round start', () => {
    const audio = new GameAudio();
    const internals = audio as unknown as { mode: string; gameIntroStep: number; playEvent(event: { type: 'round-start' }): void };
    audio.startGame();
    expect([internals.mode, internals.gameIntroStep]).toEqual(['countdown', -1]);
    internals.playEvent({ type: 'round-start' });
    expect([internals.mode, internals.gameIntroStep]).toEqual(['game', 0]);
  });

  it('clamps master volume and preserves it through mute', () => {
    const audio = new GameAudio();
    expect(audio.getVolume()).toBe(DEFAULT_MASTER_VOLUME);
    expect(audio.setVolume(1.4)).toBe(1);
    expect(audio.setVolume(-1)).toBe(0);
    expect(audio.setVolume(0.65)).toBe(0.65);
    expect(audio.toggleMuted()).toBe(true);
    expect(audio.getVolume()).toBe(0.65);
    expect(audio.toggleMuted()).toBe(false);
    expect(audio.getVolume()).toBe(0.65);
  });

  it('starts local test runs muted when requested without changing normal links', () => {
    expect(startsMutedForPlaytest({ hostname: 'localhost', search: '?muted' })).toBe(true);
    expect(startsMutedForPlaytest({ hostname: '127.0.0.1', search: '?debug=1&muted=1' })).toBe(true);
    expect(startsMutedForPlaytest({ hostname: 'localhost', search: '?muted=false' })).toBe(false);
    expect(startsMutedForPlaytest({ hostname: 'localhost', search: '?muted=0' })).toBe(false);
    expect(startsMutedForPlaytest({ hostname: 'example.com', search: '?muted=1' })).toBe(false);

    const audio = new GameAudio(true);
    expect(audio.isMuted()).toBe(true);
    expect(audio.getVolume()).toBe(DEFAULT_MASTER_VOLUME);
  });

  it('applies twice the output gain for the same slider volume', () => {
    expect(masterGainForVolume(0.65)).toBe(1.3);
    expect(masterGainForVolume(1)).toBe(2);
    expect(masterGainForVolume(0.65, true)).toBe(0);
  });

  it('schedules music far enough ahead to survive short render stalls', () => {
    expect(MUSIC_LOOKAHEAD_SECONDS).toBeGreaterThanOrEqual(0.3);
    expect(MUSIC_LOOKAHEAD_SECONDS * 1000).toBeGreaterThan(MUSIC_SCHEDULER_MS * 5);
  });

  it('scales conflict visuals and sound to an exceptional four-row tier', () => {
    expect([0, 1, 3, 4, 8].map(conflictTier)).toEqual([0, 1, 3, 4, 4]);
    const one = conflictSoundProfile(1);
    const three = conflictSoundProfile(3);
    const four = conflictSoundProfile(4);
    expect(three.gain).toBeGreaterThan(one.gain);
    expect(four.gain).toBeGreaterThan(three.gain);
    expect(four.duration).toBeGreaterThan(three.duration);
    expect(four.tier).toBe(4);
  });

  it('derives sender, recipient, impact, cleanup, and warning presentation from match state', () => {
    const engine = new MatchEngine([
      { id: 'p1', label: 'P1', controller: 'human-1' },
      { id: 'p2', label: 'P2', controller: 'human-2' },
    ], 5);
    engine.state.pendingConflict = {
      serial: 1,
      remainingWarningMs: 1500,
      senders: [{ participantId: 'p1', rows: 4, recipientIds: ['p2'] }],
      incomingRows: { p2: 4 },
    };
    engine.enqueueBoardAttack('p2',4,'conflict','p1');
    engine.state.attackQueues.p2![0]!.remainingMs=1500;
    engine.state.attackLaunchEvents=[{serial:1,participantId:'p1',rows:4,recipientIds:['p2'],remainingMs:750}];
    engine.state.conflictImpactEvent = { serial: 1, incomingRows: { p2: 3 }, maxRows: 3, pulseMs: 350 };
    engine.state.cleanupSerial = 1;
    engine.state.cleanupEvents = [{ serial: 1, participantId: 'p1', rows: 2, pulseMs: 400 }];
    expect(conflictPresentationForParticipant(engine.state, 'p1')).toMatchObject({
      senderRows: 4, incomingRows: 0, cleanupRows: 2, tier: 4, warningProgress: 0, cleanupProgress: 0.5,
    });
    expect(conflictPresentationForParticipant(engine.state, 'p2')).toMatchObject({
      senderRows: 0, incomingRows: 4, impactRows: 3, tier: 4, warningProgress: 0.5, impactProgress: 0.5, senderIds: ['p1'], shieldReady: false,
    });
  });
});
