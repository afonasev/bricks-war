import { describe, expect, it } from 'vitest';
import { FIRE_REFERENCE_HEIGHT, FIRE_REFERENCE_WIDTH, writeFireHeatPixels } from '../src/rendering/fireHeat';

function pixel(data: Uint8ClampedArray, x: number, y: number): number[] {
  const index = (y * FIRE_REFERENCE_WIDTH + x) * 4;
  return Array.from(data.slice(index, index + 4));
}

describe('approved fire heat field', () => {
  it('matches sample RGBA values from the original mockup formula', () => {
    const data = new Uint8ClampedArray(FIRE_REFERENCE_WIDTH * FIRE_REFERENCE_HEIGHT * 4);
    writeFireHeatPixels(data, 4, 0.5);
    expect(pixel(data, 30, 20)).toEqual([215, 80, 14, 211]);
    expect(pixel(data, 75, 50)).toEqual([240, 146, 31, 221]);
    expect(pixel(data, 120, 90)).toEqual([251, 200, 79, 234]);
    expect(pixel(data, 130, 50)).toEqual([0, 0, 0, 0]);
  });

  it('keeps the target height and rounded advancing front for one line', () => {
    const data = new Uint8ClampedArray(FIRE_REFERENCE_WIDTH * FIRE_REFERENCE_HEIGHT * 4);
    writeFireHeatPixels(data, 1, 0.5);
    expect(pixel(data, 30, 10)).toEqual([233, 128, 27, 219]);
    expect(pixel(data, 30, 26)).toEqual([0, 0, 0, 0]);
    expect(pixel(data, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});
