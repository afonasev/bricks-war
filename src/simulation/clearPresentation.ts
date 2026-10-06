import { BOARD_HEIGHT, type Cell, type Grid } from '../domain/types';

export const NORMAL_CLEAR_HIGHLIGHT_MS = 180;
export const clearFallDurationMs = (lines: number): number => 190 + 45 * Math.max(1, Math.min(4, lines));

export interface SettlingRow {
  fromY: number;
  toY: number;
  cells: Cell[];
}

/** Tracks row identity by its source index, including empty rows, rather than cell contents. */
export function settlingRows(grid: Grid, clearedRows: readonly number[], removedBottomRows = 0): SettlingRow[] {
  const cleared = new Set(clearedRows);
  const surviving = grid.map((cells, fromY) => ({ cells, fromY }))
    .filter((row) => !cleared.has(row.fromY));
  const kept = surviving.slice(0, Math.max(0, surviving.length - removedBottomRows));
  return kept.flatMap((row, index) => row.cells.some((cell) => cell !== null)
    ? [{ fromY: row.fromY, toY: BOARD_HEIGHT - kept.length + index, cells: [...row.cells] }]
    : []);
}

export function completedRowIndices(grid: Grid): number[] {
  return grid.flatMap((row, y) => row.every((cell) => cell !== null && cell !== 'garbage') ? [y] : []);
}

export function easeInFall(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return t * t;
}
