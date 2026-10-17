import type * as Phaser from 'phaser/dist/phaser.esm.js';
import type { SettledKind, TileStyle } from '../domain/types';

export type TileVisualState = 'active' | 'ghost' | 'preview' | 'settled';

export interface StyledTileOptions {
  style: TileStyle;
  kind: SettledKind;
  x: number;
  y: number;
  size: number;
  color: number;
  alpha: number;
  state: TileVisualState;
  polished?: boolean;
}

export interface TileRenderSignature {
  material: TileStyle | 'neutral-hazard';
  state: TileVisualState;
  detailTier: 0 | 1 | 2;
  usesGameplayColor: boolean;
  silhouette: string;
  surfacePattern: string;
  anomalyCues: readonly string[];
}

export const ANOMALY_ACCENT = 0xe216a9;
const ANOMALY_DARK = 0x57146a;
const HAZARD_COLOR = 0x8397bb;

export function detailTierForCell(size: number): 0 | 1 | 2 {
  if (size < 13) return 0;
  if (size < 22) return 1;
  return 2;
}

export function tileRenderSignature(options: Pick<StyledTileOptions, 'style' | 'kind' | 'size' | 'state'>): TileRenderSignature {
  const styleCues: Record<TileStyle, readonly [string, string]> = {
    classic: ['clean-square', 'glossy-molded-face'],
    'construction-bricks': ['construction-brick', 'gloss-and-raised-detail'],
    'pixel-adventure': ['hard-square', 'embossed-pixel-checker'],
    'stone-fortress': ['molded-slab', 'embossed-mortar'],
    marmalade: ['rounded-candy', 'crescent-and-gloss'],
    'forest-mosaic': ['leaf-tile', 'embossed-leaf'],
    'sea-crystals': ['diamond-tile', 'inset-diamond'],
  };
  const [silhouette, surfacePattern] = options.kind === 'garbage'
    ? ['hazard-square', 'neutral-cracks']
    : styleCues[options.style];
  return {
    material: options.kind === 'garbage' ? 'neutral-hazard' : options.style,
    state: options.state,
    detailTier: detailTierForCell(options.size),
    usesGameplayColor: options.kind !== 'garbage',
    silhouette,
    surfacePattern,
    anomalyCues: options.kind === 'anomaly'
      ? ['violet-magenta', 'double-outline', 'diamond-mark', 'luminous-overlay']
      : [],
  };
}

function mixColor(color: number, target: number, amount: number): number {
  const channel = (shift: number): number => {
    const from = (color >> shift) & 0xff;
    const to = (target >> shift) & 0xff;
    return Math.round(from + (to - from) * amount);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** A molded shell with a recessed lower edge and a single soft upper-left highlight. */
function drawToy(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number, alpha: number, tier: number, style: TileStyle): void {
  const pad = Math.max(.45, size * .045), w = size - 2 * pad;
  const radius = size * (style === 'pixel-adventure' ? .045 : style === 'marmalade' ? .26 : .14);
  const depth = Math.max(.5, size * .10);
  const dark = mixColor(color, 0x342137, .54);
  const light = mixColor(color, 0xffffff, .38);
  g.fillStyle(dark, alpha);
  g.fillRoundedRect(x + pad, y + pad, w, w, radius);
  g.fillStyle(color, alpha);
  g.fillRoundedRect(x + pad, y + pad, w, w - depth, radius);
  g.fillStyle(light, alpha * .65);
  g.fillRoundedRect(x + pad * 1.6, y + pad * 1.5, w - pad * 1.2, size * .16, radius * .7);
  g.fillStyle(mixColor(color, 0xffffff, .15), alpha * .65);
  g.fillRoundedRect(x + size * .13, y + size * .16, size * .72, size * .44, radius);
  if (tier > 0) {
    g.lineStyle(Math.max(.6, size * .027), light, alpha * .8);
    g.strokeRoundedRect(x + pad * 1.7, y + pad * 1.7, w - pad * 1.4, w - depth - pad, radius * .8);
    g.fillStyle(0xffffff, alpha * .66);
    g.fillRoundedRect(x + size * .12, y + size * .12, size * .23, size * .065, size * .03);
  }
  drawToyMotif(g, x, y, size, color, alpha, tier, style);
}

/** A continuous molded surface lit by a broad softbox, without separate face plates. */
function drawPolishedToy(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number, alpha: number, tier: number, style: TileStyle): void {
  // Full-cell shells keep the approved tight joins; the rim supplies contact depth.
  const radius = size * .065;
  g.fillStyle(mixColor(color, 0x25160e, .56), alpha);
  g.fillRoundedRect(x, y, size, size, radius);
  const height = size * .965;
  const shadeAt = (u: number, v: number): number => {
    // A broad reflected light rolls across the curved shoulder into the saturated face.
    const reflection = .34 * Math.exp(-(((u - .34) / .48) ** 2 + ((v - .22) / .20) ** 2));
    const top = .15 * Math.exp(-v / .065);
    const left = .10 * Math.exp(-u / .075);
    const right = .29 * Math.exp(-(1 - u) / .08);
    const bottom = .38 * Math.exp(-(1 - v) / .09);
    return reflection + top + left - right - bottom - .035 * v;
  };
  const surfaceColor = (u: number, v: number): number => {
    const shade = shadeAt(u, v);
    return mixColor(color, shade > 0 ? 0xfff8e9 : 0x301c24, Math.abs(shade));
  };
  // Small gradient patches follow the rounded silhouette without a hard inset-face edge.
  const rows = 32, columns = 6;
  for (let row = 0; row < rows; row++) {
    const top = row / rows, bottom = (row + 1) / rows;
    const yy = (top + bottom) * .5 * height;
    const dy = yy < radius ? radius - yy : yy > height - radius ? yy - (height - radius) : 0;
    const corner = radius - Math.sqrt(Math.max(0, radius * radius - dy * dy));
    for (let col = 0; col < columns; col++) {
      const left = corner + (size - corner * 2) * col / columns;
      const right = corner + (size - corner * 2) * (col + 1) / columns;
      g.fillGradientStyle(surfaceColor(left / size, top), surfaceColor(right / size, top),
        surfaceColor(left / size, bottom), surfaceColor(right / size, bottom), alpha);
      g.fillRect(x + left, y + top * height, right - left + (col < columns - 1 ? .01 : 0), height / rows + .02);
    }
  }
  drawToyMotif(g, x, y, size, color, alpha * .65, tier, style);
}

function drawToyMotif(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number, alpha: number, tier: number, style: TileStyle): void {
  const dark = mixColor(color, 0x342137, .54);
  const light = mixColor(color, 0xffffff, .38);
  if (tier === 0 || style === 'classic') return;
  const cx = x + size * .5, cy = y + size * .47, r = size * .18;
  g.lineStyle(Math.max(.8, size * .035), dark, alpha * .55);
  if (style === 'construction-bricks') {
    g.fillStyle(dark, alpha * .6); g.fillCircle(cx, cy + size * .025, r);
    g.fillStyle(light, alpha * .9); g.fillCircle(cx, cy - size * .02, r * .9);
    g.fillStyle(color, alpha); g.fillCircle(cx, cy, r * .78);
  } else if (style === 'pixel-adventure') {
    g.fillStyle(dark, alpha * .35);
    g.fillRect(cx - r, cy - r, r, r);
    g.fillRect(cx, cy, r, r);
  } else if (style === 'stone-fortress') {
    g.lineBetween(cx-r*1.5,cy,cx+r*1.5,cy);
    g.lineBetween(cx,cy,cx,cy+r);
    g.lineBetween(cx-r*.5,cy-r,cx-r*.5,cy);
  } else if (style === 'marmalade') {
    g.fillStyle(dark, alpha * .3); g.fillCircle(cx,cy,r);
    g.fillStyle(color,alpha); g.fillCircle(cx+r*.5,cy-r*.45,r*.9);
  } else if (style === 'forest-mosaic') {
    g.lineBetween(cx-r,cy+r,cx+r,cy-r);
    g.lineBetween(cx-r,cy,cx,cy+r);
    g.lineBetween(cx,cy-r,cx+r,cy);
    g.lineBetween(cx-r*.6,cy+r*.6,cx-r*.9,cy-r*.1);
  } else {
    g.fillStyle(dark,alpha*.4);
    g.fillTriangle(cx,cy-r,cx+r,cy,cx,cy+r);
    g.fillTriangle(cx,cy-r,cx,cy+r,cx-r,cy);
    if (tier > 1) { g.fillStyle(light,alpha*.7); g.fillTriangle(cx,cy-r*.7,cx,cy+r*.7,cx-r*.7,cy); }
  }
}

function drawHazard(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, alpha: number): void {
  g.fillStyle(HazardColor, alpha);
  g.fillRect(x + 1, y + 1, size - 2, size - 2);
  g.fillStyle(0xdce0e8, 0.34 * alpha);
  g.fillRect(x + 2, y + 2, size - 4, Math.max(1, size * 0.13));
  g.lineStyle(Math.max(1, size * 0.055), 0x596273, 0.52 * alpha);
  g.strokeRect(x + 1, y + 1, size - 2, size - 2);
  if (size >= 14) {
    g.lineBetween(x + size * 0.25, y + size * 0.55, x + size * 0.43, y + size * 0.38);
    g.lineBetween(x + size * 0.43, y + size * 0.38, x + size * 0.67, y + size * 0.62);
  }
}

// Alias kept local so the hazard path cannot accidentally inherit a participant color.
const HazardColor = HAZARD_COLOR;

function drawAnomalyIdentity(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, alpha: number, style: TileStyle): void {
  const pixel = style === 'pixel-adventure';
  const crystal = style === 'sea-crystals';
  const radius = pixel ? 0 : Math.max(1, size * 0.16);
  g.lineStyle(Math.max(2, size * 0.12), ANOMALY_DARK, 0.86 * alpha);
  if (crystal) {
    g.lineBetween(x + size / 2, y + 1, x + size - 1, y + size / 2);
    g.lineBetween(x + size - 1, y + size / 2, x + size / 2, y + size - 1);
    g.lineBetween(x + size / 2, y + size - 1, x + 1, y + size / 2);
    g.lineBetween(x + 1, y + size / 2, x + size / 2, y + 1);
  } else if (pixel) g.strokeRect(x + 1, y + 1, size - 2, size - 2);
  else g.strokeRoundedRect(x + 1, y + 1, size - 2, size - 2, radius);
  g.lineStyle(Math.max(1, size * 0.055), 0xffeafd, 0.96 * alpha);
  if (crystal) {
    g.lineBetween(x + size / 2, y + 3, x + size - 3, y + size / 2);
    g.lineBetween(x + size - 3, y + size / 2, x + size / 2, y + size - 3);
    g.lineBetween(x + size / 2, y + size - 3, x + 3, y + size / 2);
    g.lineBetween(x + 3, y + size / 2, x + size / 2, y + 3);
  } else if (pixel) g.strokeRect(x + 3, y + 3, size - 6, size - 6);
  else g.strokeRoundedRect(x + 3, y + 3, size - 6, size - 6, Math.max(1, radius - 1));

  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = Math.max(1.5, size * 0.14);
  g.fillStyle(0xffffff, 0.9 * alpha);
  g.fillTriangle(cx, cy - r, cx + r, cy, cx, cy + r);
  g.fillTriangle(cx, cy - r, cx, cy + r, cx - r, cy);
  g.fillStyle(ANOMALY_ACCENT, 0.22 * alpha);
  g.fillCircle(cx, cy, Math.max(2, size * 0.27));
}

export function drawStyledTile(g: Phaser.GameObjects.Graphics, options: StyledTileOptions): void {
  const { style, kind, x, y, size, alpha } = options;
  if (kind === 'garbage') {
    drawHazard(g, x, y, size, alpha);
    return;
  }
  const color = kind === 'anomaly' ? ANOMALY_ACCENT : options.color;
  const tier = detailTierForCell(size);
  if (options.state === 'ghost' && kind !== 'anomaly') {
    const inset = Math.max(.5, size * .06);
    g.fillStyle(color, alpha * .22);
    g.fillRoundedRect(x + inset, y + inset, size - 2 * inset, size - 2 * inset, size * .12);
    g.lineStyle(Math.max(.6, size * .045), mixColor(color, 0x493b32, .32), alpha);
    g.strokeRoundedRect(x + inset, y + inset, size - 2 * inset, size - 2 * inset, size * .12);
    drawToyMotif(g, x, y, size, color, alpha * .45, tier, style);
    return;
  }
  (options.polished ? drawPolishedToy : drawToy)(g, x, y, size, color, alpha, tier, style);

  if (kind === 'anomaly') drawAnomalyIdentity(g, x, y, size, alpha, style);
}
