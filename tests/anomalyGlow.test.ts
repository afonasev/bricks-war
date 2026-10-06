import { describe, expect, it } from 'vitest';
import { anomalyGlowStyle, anomalyOutlineSegments } from '../src/rendering/anomalyGlow';

describe('active anomaly glow', () => {
  it('draws only the outside contour of connected cells', () => {
    const segments = anomalyOutlineSegments([{ x: 0, y: 0 }, { x: 1, y: 0 }]);

    expect(segments).toHaveLength(6);
    expect(segments).not.toContainEqual({ x1: 1, y1: 0, x2: 1, y2: 1 });
    expect(segments).not.toContainEqual({ x1: 1, y1: 1, x2: 1, y2: 0 });
  });

  it('keeps a restrained but clearly visible pulsing outline', () => {
    const styles = [0, 170 * Math.PI / 2, 170 * Math.PI * 1.5].map((time) => anomalyGlowStyle(time, 29));

    for (const style of styles) {
      expect(style.outerAlpha).toBeGreaterThanOrEqual(0.2);
      expect(style.outerAlpha).toBeLessThanOrEqual(0.32);
      expect(style.innerAlpha).toBeGreaterThanOrEqual(0.78);
      expect(style.innerAlpha).toBeLessThanOrEqual(0.96);
      expect(style.outerWidth).toBeGreaterThan(style.innerWidth);
    }
  });
});
