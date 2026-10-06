import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_OPTION_SELECTIONS,
  MIN_GRAVITY_INTERVAL_MS,
  gravityIntervalFor,
  pressureDurationMs,
  pressureStartMs,
  resolveMatchOptions,
} from '../src/simulation/matchOptions';

describe('match pacing options', () => {
  it('resolves every named battle difficulty and soft-drop preset', () => {
    expect(resolveMatchOptions()).toEqual({
      ...DEFAULT_MATCH_OPTION_SELECTIONS,
      startingGravityMs: 1000,
      accelerationPercent: 8,
      piecesPerLevel: 15,
      softDropIntervalMs: 150,
      tuning: null,
    });
    expect(['family', 'normal', 'sport'].map((battleDifficulty) => (
      resolveMatchOptions({ battleDifficulty: battleDifficulty as 'family' | 'normal' | 'sport' }).startingGravityMs
    ))).toEqual([1250, 1000, 750]);
    expect(['slow', 'fast', 'very-fast'].map((softDrop) => (
      resolveMatchOptions({ softDrop: softDrop as 'slow' | 'fast' | 'very-fast' }).softDropIntervalMs
    ))).toEqual([150, 110, 80]);
    expect(resolveMatchOptions({ pressure: 'fixed' }).pressure).toBe('fixed');
    expect(resolveMatchOptions({ pressure: 'extended' }).pressure).toBe('extended');
    expect(resolveMatchOptions().conflictEnabled).toBe(true);
    expect(resolveMatchOptions().matchVariant).toBe('free-for-all');
    expect(resolveMatchOptions().conflictTargeting).toBe('all-opponents');
    expect(resolveMatchOptions({ conflictEnabled: false }).conflictEnabled).toBe(false);
  });

  it('applies profile speed and the lower bound', () => {
    const family = resolveMatchOptions();
    expect(gravityIntervalFor(0, family)).toBe(1000);
    expect(gravityIntervalFor(1, family)).toBe(920);
    expect(gravityIntervalFor(100, family)).toBe(MIN_GRAVITY_INTERVAL_MS);
    expect(gravityIntervalFor(0, resolveMatchOptions({ battleDifficulty: 'family' }))).toBe(1250);
    expect(gravityIntervalFor(0, resolveMatchOptions({ battleDifficulty: 'sport' }))).toBe(750);
  });

  it('calculates fixed, automatic, and extended pressure boundaries', () => {
    expect(pressureDurationMs(60_000, 'automatic')).toBe(60_000);
    expect(pressureStartMs(60_000, 'automatic')).toBe(0);
    expect(pressureStartMs(120_000, 'automatic')).toBe(60_000);
    expect(pressureStartMs(300_000, 'automatic')).toBe(210_000);
    expect(pressureStartMs(600_000, 'automatic')).toBe(420_000);
    expect(pressureStartMs(300_000, 'fixed')).toBe(240_000);
    expect(pressureStartMs(300_000, 'extended')).toBe(180_000);
  });
});
