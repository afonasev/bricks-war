import { describe, expect, it } from 'vitest';
import { DEFAULT_TILT_TUNING, TiltControls, withTiltSensitivity } from '../src/controllers/tilt';
describe('tilt controls', () => {
  it('calibrates, maps tilt, and re-arms rotation through neutral', () => { const tilt = new TiltControls(); tilt.calibrate({ beta: 0, gamma: 0 }); let state; for (let i = 0; i < 6; i += 1) state = tilt.update({ beta: 0, gamma: 30 }, 60); expect(state).toMatchObject({ right: true }); let rotated = false; for (let i = 0; i < 6; i += 1) rotated ||= Boolean(tilt.update({ beta: -30, gamma: 0 }, 60)?.rotate); expect(rotated).toBe(true); expect(tilt.update({ beta: -30, gamma: 0 }, 300)?.rotate).toBe(false); for (let i = 0; i < 10; i += 1) tilt.update({ beta: 0, gamma: 0 }, 60); rotated = false; for (let i = 0; i < 6; i += 1) rotated ||= Boolean(tilt.update({ beta: -30, gamma: 0 }, 60)?.rotate); expect(rotated).toBe(true); });
  it('keeps lateral sensitivity reduced while making forward and backward tilt gentle', () => {
    expect(withTiltSensitivity(DEFAULT_TILT_TUNING, 0.5)).toMatchObject({ horizontalThreshold: 28, rotateThreshold: 10, dropThreshold: 10, deadZone: 6 });
  });
  it('adopts a long stable position inside the neutral zone as the new neutral', () => {
    const tilt = new TiltControls(); tilt.calibrate({ beta: 0, gamma: 0 });
    let state;
    for (let i = 0; i < 16; i += 1) state = tilt.update({ beta: 4, gamma: 0 }, 50);
    expect(state).toEqual({ left: false, right: false, down: false, rotate: false });
    for (let i = 0; i < 6; i += 1) state = tilt.update({ beta: 16, gamma: 0 }, 50, withTiltSensitivity(DEFAULT_TILT_TUNING, 0.5));
    expect(state?.down).toBe(true);
  });
  it('does not recenter while an acceleration tilt is held', () => {
    const tilt = new TiltControls(); const tuning = withTiltSensitivity(DEFAULT_TILT_TUNING, 0.5); tilt.calibrate({ beta: 0, gamma: 0 });
    let state;
    for (let i = 0; i < 24; i += 1) state = tilt.update({ beta: 16, gamma: 0 }, 50, tuning);
    expect(state?.down).toBe(true);
  });
});
