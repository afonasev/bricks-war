import { describe, expect, it } from 'vitest';
import { historyScrollDelta } from '../src/ui/historyScroll';

describe('release history right-stick scroll', () => {
  it('ignores stick drift and invalid input', () => {
    for (const axis of [0, 0.17, -0.18, NaN, Infinity]) expect(historyScrollDelta(axis, 16)).toBe(0);
  });
  it('scrolls both ways with proportional speed', () => {
    expect(historyScrollDelta(1, 20)).toBe(18);
    expect(historyScrollDelta(-1, 20)).toBe(-18);
    expect(historyScrollDelta(0.59, 20)).toBeCloseTo(9);
  });
  it('keeps the same speed across frame rates and bounds resume jumps', () => {
    expect(historyScrollDelta(1, 10) * 2).toBe(historyScrollDelta(1, 20));
    expect(historyScrollDelta(1, 3000)).toBe(45);
    expect(historyScrollDelta(1, -1)).toBe(0);
    expect(historyScrollDelta(1, NaN)).toBe(0);
  });
});
