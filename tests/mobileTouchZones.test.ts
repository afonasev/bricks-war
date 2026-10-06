import { describe, expect, it } from 'vitest';
import { combineMobileControls, mobileTouchActionAt } from '../src/controllers/mobileTouchZones';

const neutral = { left: false, right: false, down: false, rotate: false };

describe('mobile touch zones', () => {
  it('maps the lower 21.875% into equal left, down, and right zones', () => {
    expect(mobileTouchActionAt(20, 640, 390, 800)).toBe('left');
    expect(mobileTouchActionAt(195, 640, 390, 800)).toBe('down');
    expect(mobileTouchActionAt(380, 640, 390, 800)).toBe('right');
  });

  it('keeps rotation available until the final 21.875% of the screen', () => {
    expect(mobileTouchActionAt(195, 624.99, 390, 800)).toBe('rotate');
    expect(mobileTouchActionAt(195, 625, 390, 800)).toBe('down');
  });

  it('merges held touch and tilt controls without one clearing the other', () => {
    expect(combineMobileControls({ ...neutral, down: true }, { ...neutral, left: true })).toEqual({ left: true, right: false, down: true, rotate: false });
    expect(combineMobileControls({ ...neutral, left: true }, { ...neutral, right: true })).toEqual(neutral);
    expect(combineMobileControls({ ...neutral, rotate: true }, neutral).rotate).toBe(true);
  });
});
