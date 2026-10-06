import { describe, expect, it } from 'vitest';
import {
  AUDIO_EVENT_PRIORITY,
  CRITICAL_MUSIC_DUCK_GAIN,
  MUSIC_DIRECTIONS,
  SFX_DIRECTIONS,
  musicGainForPriority,
  variationIndex,
} from '../src/audio/audioDirections';

describe('audio directions', () => {
  it('ships all requested gameplay and menu music directions', () => {
    expect(MUSIC_DIRECTIONS.map((direction) => direction.id)).toEqual([
      'neon-workshop', 'toybox-tactics', 'arcade-skyline', 'glass-gravity', 'brickbeat',
    ]);
    for (const direction of MUSIC_DIRECTIONS) {
      expect(direction.matchIntro.length).toBeGreaterThanOrEqual(6);
      expect(direction.melody.length).toBeGreaterThanOrEqual(8);
      expect(direction.menuMelody.length).toBeGreaterThanOrEqual(8);
      expect(direction.chords.length).toBeGreaterThanOrEqual(3);
      expect(direction.melody.slice(0, 4)).not.toEqual(direction.menuMelody.slice(0, 4));
      expect(direction.matchIntro).not.toEqual(direction.menuMelody.slice(0, direction.matchIntro.length));
    }
  });

  it('keeps music motifs low enough to leave room for a response phrase', () => {
    for (const direction of MUSIC_DIRECTIONS) {
      expect(direction.melody.every((note) => note <= 88)).toBe(true);
      expect(direction.menuMelody.every((note) => note <= 88)).toBe(true);
      expect(direction.matchIntro.every((note) => note <= 88)).toBe(true);
    }
  });

  it('maps every review-critical event and supplies four SFX directions', () => {
    expect(SFX_DIRECTIONS).toHaveLength(4);
    for (const event of ['rotate', 'lock', 'line-clear', 'level-up', 'conflict-launch', 'conflict-impact', 'shield-full-charge', 'shield-block', 'active-defense', 'anomaly-spawn', 'final-push', 'results']) {
      expect(AUDIO_EVENT_PRIORITY[event]).toBeDefined();
    }
  });

  it('uses low-mid material bodies instead of bright tactile ping roots', () => {
    for (const direction of SFX_DIRECTIONS) {
      expect(direction.body).toBeLessThanOrEqual(260);
      expect(direction.contact).toBeLessThanOrEqual(1100);
      expect(direction.brightness).toBeLessThan(0.7);
    }
  });

  it('cycles frequent actions through three deterministic variations', () => {
    for (const event of ['rotate', 'lock', 'line-clear']) {
      expect(new Set([0, 1, 2].map((occurrence) => variationIndex(event, 3, occurrence))).size).toBe(3);
    }
  });

  it('reserves a bounded duck only for critical feedback', () => {
    expect(musicGainForPriority('critical', 0.25)).toBe(CRITICAL_MUSIC_DUCK_GAIN);
    expect(musicGainForPriority('reward', 0.25)).toBe(0.25);
  });
});
