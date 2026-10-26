import { describe, expect, it, vi } from 'vitest';
import { activePiece } from '../src/simulation/tetrominoes';
import { addGrayRows, canPlace, createBoard } from '../src/simulation/board';

describe('gray-row diagnostics', () => {
  it('logs active-piece placement failure separately from settled overflow', () => {
    const board = createBoard('O', 'I');
    board.active = activePiece('O', 0, 3, 0);
    for (const row of board.grid.slice(2)) row.fill('T');
    expect(canPlace(board.grid, board.active)).toBe(true);
    expect(board.grid[0]!.every((cell) => cell === null)).toBe(true);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(addGrayRows(board, 1)).toBe(false);
      expect(board.alive).toBe(false);
      expect(board.active).toBeNull();
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledWith('[Bricks War] gray-row top-out', expect.objectContaining({
        reason: 'active-piece-no-placement', requestedRows: 1, rowIndex: 1,
        active: expect.objectContaining({ id: 'classic-O', x: 3, y: 0 }),
      }));
    } finally {
      warning.mockRestore();
    }
  });

  it('logs structured settled-overflow context', () => {
    const board = createBoard('O', 'I');
    board.grid[0]![0] = 'T';
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(addGrayRows(board, 3)).toBe(false);
    expect(warning).toHaveBeenCalledWith('[Bricks War] gray-row top-out', expect.objectContaining({
      reason: 'settled-overflow', requestedRows: 3, rowIndex: 1, occupiedCells: 1,
    }));
    warning.mockRestore();
  });
});
