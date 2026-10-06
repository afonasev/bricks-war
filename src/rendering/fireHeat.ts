// The approved comparison mockup renders its heat field at 26 pixels per cell.
export const FIRE_REFERENCE_CELL_SIZE = 26;
export const FIRE_REFERENCE_WIDTH = FIRE_REFERENCE_CELL_SIZE * 10;
export const FIRE_REFERENCE_HEIGHT = FIRE_REFERENCE_CELL_SIZE * 4;

function byte(value: number): number {
  return Math.max(0, Math.min(255, Math.trunc(value)));
}

function insideRoundedBand(x: number, y: number, width: number, height: number, radius: number): boolean {
  if (radius === 0) return true;
  const cornerX = x < radius ? radius : x >= width - radius ? width - radius - 1 : x;
  const cornerY = y < radius ? radius : y >= height - radius ? height - radius - 1 : y;
  const dx = x - cornerX;
  const dy = y - cornerY;
  return dx * dx + dy * dy <= radius * radius;
}

/** Writes the heat formula from the approved burn_block mockup into a reusable RGBA buffer. */
export function writeFireHeatPixels(
  pixels: Uint8ClampedArray,
  rows: number,
  progress: number,
  phase = progress,
): void {
  pixels.fill(0);
  const width = Math.max(1, Math.round(Math.max(0, Math.min(1, progress)) * FIRE_REFERENCE_WIDTH));
  const height = Math.max(1, Math.min(4, rows)) * FIRE_REFERENCE_CELL_SIZE;
  const radius = Math.min(8, Math.floor(height / 4), Math.floor(width / 2));
  // The four comparison panels start 2.8 seconds apart. Matching their local
  // time gives the same heat pattern at the same progress in every panel.
  const time = 0.35 + (rows - 1) * 2.8 + phase;
  const swirlSinX = new Float64Array(width);
  const swirlCosX = new Float64Array(width);
  const rippleSinX = new Float64Array(width);
  const rippleCosX = new Float64Array(width);
  const grainSinX = new Float64Array(width);
  const grainCosX = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    const swirlX = x * 0.105 - time * 15;
    const rippleX = Math.sin(x * 0.08 - time * 8);
    const grainX = x * 0.39 + time * 22;
    swirlSinX[x] = Math.sin(swirlX);
    swirlCosX[x] = Math.cos(swirlX);
    rippleSinX[x] = Math.sin(rippleX);
    rippleCosX[x] = Math.cos(rippleX);
    grainSinX[x] = Math.sin(grainX);
    grainCosX[x] = Math.cos(grainX);
  }
  for (let y = 0; y < height; y += 1) {
    const swirlY = Math.sin(y * 0.18 + time * 10) * 1.4;
    const rippleY = y * 0.23 + time * 17;
    const grainY = y * 0.28;
    const swirlSinY = Math.sin(swirlY);
    const swirlCosY = Math.cos(swirlY);
    const rippleSinY = Math.sin(rippleY);
    const rippleCosY = Math.cos(rippleY);
    const grainSinY = Math.sin(grainY);
    const grainCosY = Math.cos(grainY);
    for (let x = 0; x < width; x += 1) {
      if (!insideRoundedBand(x, y, width, height, radius)) continue;
      const swirl = swirlSinX[x]! * swirlCosY + swirlCosX[x]! * swirlSinY;
      const ripple = rippleSinY * rippleCosX[x]! + rippleCosY * rippleSinX[x]!;
      const grain = grainSinX[x]! * grainCosY + grainCosX[x]! * grainSinY;
      const heat = Math.max(0, Math.min(1, 0.48 + 0.23 * swirl + 0.19 * ripple + 0.08 * grain));
      const distance = width - 1 - x;
      const lead = Math.exp(-((distance / 16) ** 2));
      const index = (y * FIRE_REFERENCE_WIDTH + x) * 4;
      pixels[index] = byte(205 + 48 * heat + 15 * lead);
      pixels[index + 1] = byte(54 + 124 * heat + 73 * lead);
      pixels[index + 2] = byte(8 + 32 * heat + 65 * lead);
      pixels[index + 3] = byte(207 + 20 * heat + 17 * lead);
    }
  }
}
