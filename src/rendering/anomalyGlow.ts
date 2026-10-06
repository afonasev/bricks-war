import type { Position } from '../domain/types';

export interface OutlineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AnomalyGlowStyle {
  outerAlpha: number;
  outerWidth: number;
  innerAlpha: number;
  innerWidth: number;
}

export function anomalyOutlineSegments(cells: readonly Position[]): OutlineSegment[] {
  const occupied = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
  const segments: OutlineSegment[] = [];

  for (const cell of cells) {
    if (!occupied.has(`${cell.x},${cell.y - 1}`)) {
      segments.push({ x1: cell.x, y1: cell.y, x2: cell.x + 1, y2: cell.y });
    }
    if (!occupied.has(`${cell.x + 1},${cell.y}`)) {
      segments.push({ x1: cell.x + 1, y1: cell.y, x2: cell.x + 1, y2: cell.y + 1 });
    }
    if (!occupied.has(`${cell.x},${cell.y + 1}`)) {
      segments.push({ x1: cell.x + 1, y1: cell.y + 1, x2: cell.x, y2: cell.y + 1 });
    }
    if (!occupied.has(`${cell.x - 1},${cell.y}`)) {
      segments.push({ x1: cell.x, y1: cell.y + 1, x2: cell.x, y2: cell.y });
    }
  }

  return segments;
}

export function anomalyGlowStyle(elapsedMs: number, cellSize: number): AnomalyGlowStyle {
  const pulse = (Math.sin(elapsedMs / 170) + 1) / 2;
  return {
    outerAlpha: 0.2 + pulse * 0.12,
    outerWidth: Math.max(3, cellSize * 0.22),
    innerAlpha: 0.78 + pulse * 0.18,
    innerWidth: Math.max(1.5, cellSize * 0.075),
  };
}
