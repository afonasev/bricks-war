import { describe, expect, it } from 'vitest';
import { canvasViewport } from '../src/rendering/canvasViewport';

describe('physical canvas buffer with logical arena coordinates', () => {
  it.each([[3840, 2160, 1], [2560, 1440, 1.5], [1920, 1080, 2]])('uses full physical 4K at %i × %i / DPR %s', (width, height, density) => {
    expect(canvasViewport(width, height, density)).toEqual({ width, height, pixelWidth: 3840, pixelHeight: 2160 });
  });
  it('rounds fractional physical sizes without altering layout coordinates', () => {
    expect(canvasViewport(1101, 701, 1.5)).toEqual({ width: 1101, height: 701, pixelWidth: 1652, pixelHeight: 1052 });
  });
  it.each([NaN, Infinity, 0, -2])('uses a usable buffer when density is invalid (%s)', density => {
    expect(canvasViewport(1280, 720, density)).toEqual({ width: 1280, height: 720, pixelWidth: 1280, pixelHeight: 720 });
  });
});
