import { describe, expect, it, vi } from 'vitest';
import { addGrayRows, createBoard } from '../src/simulation/board';

describe('gray-row diagnostics', () => {
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
