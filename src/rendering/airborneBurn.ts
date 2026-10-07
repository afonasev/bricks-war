import type { ActivePiece } from '../domain/types';
import { pieceCells } from '../simulation/tetrominoes';

/** One sweep through the whole piece, in board coordinates, from bottom to top. */
export function airborneBurnCells(piece: ActivePiece, progress: number, calm: boolean) {
  const cells = pieceCells(piece);
  const top = Math.min(...cells.map((cell) => cell.y));
  const bottom = Math.max(...cells.map((cell) => cell.y)) + 1;
  const front = bottom - (bottom - top) * Math.max(0, Math.min(1, progress));
  return cells.map((cell) => ({ ...cell,
    remaining: Math.max(0, Math.min(1, front - cell.y)),
    heat: calm ? 0.55 : Math.max(0, 1 - Math.abs(cell.y + 0.5 - front)),
  }));
}
