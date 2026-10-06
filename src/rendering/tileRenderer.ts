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
    classic: ['clean-square', 'restrained-bevel'],
    'construction-bricks': ['construction-brick', 'gloss-and-raised-detail'],
    'pixel-adventure': ['hard-square', 'pixel-checker'],
    'stone-fortress': ['chiseled-slab', 'mortar-and-cracks'],
    marmalade: ['gel-blob', 'bubbles-and-gloss'],
    'forest-mosaic': ['wood-inlay', 'leaf-and-grain'],
    'sea-crystals': ['wide-cut-crystal', 'eight-facets'],
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

function drawClassic(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number, alpha: number, tier: number): void {
  const inset = Math.max(1, Math.round(size * 0.06));
  const dark = mixColor(color, 0x071b4a, 0.68);
  const bright = mixColor(color, 0xffffff, 0.32);
  g.fillStyle(dark, alpha);
  g.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  g.fillStyle(color, alpha);
  g.fillRect(x + inset * 2, y + inset * 2, size - inset * 4, size - inset * 4);
  g.fillStyle(bright, 0.8 * alpha);
  g.fillRect(x + inset * 2, y + inset * 2, size - inset * 4, Math.max(1, size * 0.12));
  if (tier > 0) {
    g.fillStyle(mixColor(color, 0x071b4a, 0.2), 0.46 * alpha);
    g.fillRect(x + inset * 2, y + size - inset * 2 - Math.max(1, size * 0.1), size - inset * 4, Math.max(1, size * 0.1));
  }
}

function drawConstructionBricks(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number, alpha: number, tier: number): void {
  const inset = Math.max(1, Math.round(size * 0.08));
  const radius = Math.max(1, size * 0.12);
  const shadow = mixColor(color, 0x071b4a, 0.7);
  const bright = mixColor(color, 0xffffff, 0.28);
  g.fillStyle(shadow, alpha);
  g.fillRoundedRect(x + inset, y + inset, size - inset * 2, size - inset * 2, radius);
  g.fillStyle(color, alpha);
  g.fillRoundedRect(x + inset, y + inset, size - inset * 2, size - inset * 2 - Math.max(1, size * 0.12), radius);
  g.fillStyle(bright, 0.86 * alpha);
  g.fillRoundedRect(x + inset * 2, y + inset * 1.5, size - inset * 4, Math.max(1, size * 0.16), Math.max(1, radius * 0.45));
  if (tier > 0) {
    const studRadius = Math.max(2, size * 0.22);
    g.fillStyle(shadow, 0.82 * alpha);
    g.fillCircle(x + size * 0.52, y + size * 0.46, studRadius);
    g.fillStyle(bright, alpha);
    g.fillCircle(x + size * 0.48, y + size * 0.41, Math.max(1, studRadius * 0.82));
  }
  g.lineStyle(Math.max(1, size * 0.06), shadow, 0.82 * alpha);
  g.strokeRoundedRect(x + inset, y + inset, size - inset * 2, size - inset * 2, radius);
}

function drawPixelAdventure(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number, alpha: number, tier: number): void {
  const edge = Math.max(1, Math.round(size * 0.13));
  const dark = mixColor(color, 0x10272f, 0.62);
  const bright = mixColor(color, 0xffffff, 0.28);
  g.fillStyle(dark, alpha);
  g.fillRect(x + 1, y + 1, size - 2, size - 2);
  g.fillStyle(bright, alpha);
  g.fillRect(x + edge, y + edge, size - edge * 2, size - edge * 2);
  g.fillStyle(mixColor(color, 0xffffff, 0.7), 0.72 * alpha);
  g.fillRect(x + edge, y + edge, size - edge * 2, Math.max(1, edge * 0.75));
  g.fillRect(x + edge, y + edge, Math.max(1, edge * 0.75), size - edge * 2);
  const pixel = Math.max(1, Math.round(size * 0.16));
  g.fillStyle(dark, 0.66 * alpha);
  g.fillRect(x + edge, y + size - edge - pixel, pixel, pixel);
  g.fillRect(x + size - edge - pixel, y + edge, pixel, pixel);
  if (tier > 0) {
    g.lineStyle(Math.max(1, size * 0.06), dark, 0.8 * alpha);
    g.lineBetween(x + size / 2, y + edge, x + size / 2, y + size / 2);
    g.lineBetween(x + edge, y + size / 2, x + size - edge, y + size / 2);
  }
}

function drawStoneFortress(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number, alpha: number, tier: number): void {
  const stone = mixColor(color, 0xffffff, 0.18);
  const radius = Math.max(1, size * 0.04);
  const mortar = mixColor(stone, 0x071b4a, 0.72);
  g.fillStyle(mortar, alpha);
  g.fillRoundedRect(x + 1, y + 1, size - 2, size - 2, radius);
  g.fillStyle(stone, alpha);
  g.fillRoundedRect(x + 3, y + 2, size - 6, size - 4, radius);
  g.lineStyle(Math.max(1, size * 0.07), mixColor(stone, 0xffffff, 0.7), 0.72 * alpha);
  g.lineBetween(x + 4, y + 3, x + size - 4, y + 3);
  g.lineStyle(Math.max(1, size * 0.075), mortar, 0.82 * alpha);
  g.lineBetween(x + 3, y + size * 0.56, x + size - 3, y + size * 0.56);
  if (tier > 0) {
    g.lineBetween(x + size * 0.34, y + size * 0.56, x + size * 0.34, y + size - 3);
    g.lineStyle(Math.max(1, size * 0.045), mixColor(stone, 0x161d1b, 0.72), 0.76 * alpha);
    g.lineBetween(x + size * 0.66, y + 3, x + size * 0.54, y + size * 0.32);
    g.lineBetween(x + size * 0.54, y + size * 0.32, x + size * 0.67, y + size * 0.48);
    if (tier > 1) {
      g.fillStyle(mortar, 0.52 * alpha);
      g.fillCircle(x + size * 0.22, y + size * 0.28, Math.max(1, size * 0.045));
    }
  }
}

function drawMarmalade(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number, alpha: number, tier: number): void {
  const radius = Math.max(3, size * 0.42);
  const jellyDark = mixColor(color, 0x531832, 0.58);
  g.fillStyle(jellyDark, 0.9 * alpha);
  g.fillRoundedRect(x + 1, y + 2, size - 2, size - 3, radius);
  g.fillStyle(mixColor(color, 0xffffff, 0.26), 0.92 * alpha);
  g.fillRoundedRect(x + 3, y + 3, size - 6, size - 7, Math.max(2, radius - 2));
  g.fillStyle(0xffffff, 0.72 * alpha);
  g.fillCircle(x + size * 0.32, y + size * 0.28, Math.max(1, size * (tier > 0 ? 0.12 : 0.085)));
  if (tier > 0) {
    g.fillStyle(jellyDark, 0.32 * alpha);
    g.fillCircle(x + size * 0.66, y + size * 0.62, Math.max(1, size * 0.095));
    if (tier > 1) g.fillCircle(x + size * 0.42, y + size * 0.72, Math.max(1, size * 0.055));
  }
  g.lineStyle(Math.max(1, size * 0.065), jellyDark, 0.62 * alpha);
  g.strokeRoundedRect(x + 1, y + 2, size - 2, size - 3, radius);
}

function drawForestMosaic(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number, alpha: number, tier: number): void {
  const wood = mixColor(color, 0xffb51f, 0.18);
  const bark = mixColor(color, 0x071b4a, 0.8);
  g.fillStyle(bark, alpha);
  g.fillRoundedRect(x + 1, y + 1, size - 2, size - 2, Math.max(1, size * 0.14));
  g.fillStyle(wood, alpha);
  g.fillRoundedRect(x + 3, y + 3, size - 6, size - 6, Math.max(1, size * 0.08));
  const cx = x + size / 2;
  const cy = y + size / 2;
  const leaf = Math.max(2, size * 0.26);
  g.fillStyle(mixColor(color, 0x20e85d, 0.42), 0.92 * alpha);
  g.fillTriangle(cx, cy - leaf, cx + leaf, cy, cx, cy + leaf);
  g.fillTriangle(cx, cy - leaf, cx, cy + leaf, cx - leaf, cy);
  g.lineStyle(Math.max(1, size * 0.055), mixColor(wood, 0x3b2818, 0.68), 0.72 * alpha);
  g.lineBetween(x + size * 0.18, y + size * 0.76, x + size * 0.82, y + size * 0.24);
  if (tier > 0) {
    g.lineStyle(Math.max(1, size * 0.035), mixColor(wood, 0xffe2a8, 0.5), 0.5 * alpha);
    g.lineBetween(x + size * 0.18, y + size * 0.28, x + size * 0.42, y + size * 0.18);
    if (tier > 1) g.lineBetween(x + size * 0.62, y + size * 0.82, x + size * 0.84, y + size * 0.7);
  }
}

function drawSeaCrystals(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color: number, alpha: number, tier: number): void {
  const crystal = mixColor(color, 0x2df4ff, 0.2);
  const dark = mixColor(crystal, 0x092458, 0.72);
  const cx = x + size / 2;
  const cy = y + size / 2;
  const bevel = Math.max(1, size * 0.16);
  g.fillStyle(dark, 0.88 * alpha);
  g.fillRect(x, y + bevel, size, size - bevel * 2);
  g.fillRect(x + bevel, y, size - bevel * 2, size);
  g.fillTriangle(x, y + bevel, x + bevel, y, x + bevel, y + bevel);
  g.fillTriangle(x + size - bevel, y, x + size, y + bevel, x + size - bevel, y + bevel);
  g.fillTriangle(x + size, y + size - bevel, x + size - bevel, y + size, x + size - bevel, y + size - bevel);
  g.fillTriangle(x + bevel, y + size, x, y + size - bevel, x + bevel, y + size - bevel);
  if (tier > 0) {
    const inner = bevel * 1.42;
    g.fillStyle(mixColor(crystal, 0xffffff, 0.58), 0.9 * alpha);
    g.fillTriangle(cx, y + inner, cx, cy, x + inner, cy);
    g.fillStyle(crystal, 0.84 * alpha);
    g.fillTriangle(cx, y + inner, x + size - inner, cy, cx, cy);
    g.fillStyle(mixColor(crystal, 0x2155a3, 0.55), 0.72 * alpha);
    g.fillTriangle(x + size - inner, cy, cx, y + size - inner, cx, cy);
    g.fillStyle(mixColor(crystal, 0xbffcff, 0.3), 0.76 * alpha);
    g.fillTriangle(cx, y + size - inner, x + inner, cy, cx, cy);
  }
  g.lineStyle(Math.max(1, size * 0.055), 0xe9ffff, (tier > 0 ? 0.88 : 0.68) * alpha);
  g.lineBetween(x + bevel, y, x + size - bevel, y);
  g.lineBetween(x + size - bevel, y, x + size, y + bevel);
  g.lineBetween(x + size, y + bevel, x + size, y + size - bevel);
  g.lineBetween(x + size, y + size - bevel, x + size - bevel, y + size);
  g.lineBetween(x + size - bevel, y + size, x + bevel, y + size);
  g.lineBetween(x + bevel, y + size, x, y + size - bevel);
  g.lineBetween(x, y + size - bevel, x, y + bevel);
  g.lineBetween(x, y + bevel, x + bevel, y);
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
  if (style === 'classic') drawClassic(g, x, y, size, color, alpha, tier);
  else if (style === 'construction-bricks') drawConstructionBricks(g, x, y, size, color, alpha, tier);
  else if (style === 'pixel-adventure') drawPixelAdventure(g, x, y, size, color, alpha, tier);
  else if (style === 'stone-fortress') drawStoneFortress(g, x, y, size, color, alpha, tier);
  else if (style === 'marmalade') drawMarmalade(g, x, y, size, color, alpha, tier);
  else if (style === 'forest-mosaic') drawForestMosaic(g, x, y, size, color, alpha, tier);
  else drawSeaCrystals(g, x, y, size, color, alpha, tier);

  if (kind === 'anomaly') drawAnomalyIdentity(g, x, y, size, alpha, style);
}
