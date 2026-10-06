import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH, HIDDEN_ROWS, type ActivePiece } from '../src/domain/types';
import {
  canPlace,
  addRisingFloor,
  addGrayRows,
  clearCompletedLines,
  createBoard,
  createEmptyGrid,
  lockPiece,
  removeBottomGrayRows,
  tryMove,
  tryRotateClockwise,
} from '../src/simulation/board';
import { activePiece } from '../src/simulation/tetrominoes';

describe('board rules', () => {
  it('blocks pieces at walls and floor', () => {
    const grid = createEmptyGrid();
    expect(canPlace(grid, activePiece('I', 0, -1, 0))).toBe(false);
    expect(canPlace(grid, activePiece('I', 0, 0, BOARD_HEIGHT - 2))).toBe(true);
    expect(canPlace(grid, activePiece('I', 0, 0, BOARD_HEIGHT - 1))).toBe(false);
  });

  it('moves only when a destination is legal', () => {
    const board = createBoard('O', 'I');
    board.active = activePiece('O', 0, -1, 0);
    expect(tryMove(board, -1, 0)).toBe(false);
    expect(board.active?.x).toBe(-1);
    expect(tryMove(board, 1, 0)).toBe(true);
    expect(board.active?.x).toBe(0);
  });

  it('uses clockwise wall kicks near an edge', () => {
    const board = createBoard('T', 'I');
    board.active = activePiece('T', 3, 8, 3);
    expect(tryRotateClockwise(board)).toBe(true);
    expect(board.active?.rotation).toBe(0);
    expect(board.active && canPlace(board.grid, board.active)).toBe(true);
  });

  it('clears multiple complete lines and preserves rows above', () => {
    const grid = createEmptyGrid();
    grid[BOARD_HEIGHT - 1]?.fill('Z');
    grid[BOARD_HEIGHT - 2]?.fill('S');
    grid[BOARD_HEIGHT - 3]![0] = 'T';
    expect(clearCompletedLines(grid)).toBe(2);
    expect(grid).toHaveLength(BOARD_HEIGHT);
    expect(grid[BOARD_HEIGHT - 1]?.[0]).toBe('T');
  });

  it('locks all four cells into the grid', () => {
    const board = createBoard('O', 'I');
    board.active = activePiece('O', 0, 3, BOARD_HEIGHT - 2) satisfies ActivePiece;
    lockPiece(board);
    const occupied = board.grid.flat().filter(Boolean);
    expect(occupied).toHaveLength(4);
    expect(board.active).toBeNull();
  });

  it('creates a ten-column board', () => {
    const grid = createEmptyGrid();
    expect(grid.every((row) => row.length === BOARD_WIDTH)).toBe(true);
  });

  it('spawns every piece at least partly inside the visible playfield', () => {
    for (const kind of ['I', 'J', 'L', 'O', 'S', 'T', 'Z'] as const) {
      const board = createBoard(kind, 'I');
      expect(board.active).not.toBeNull();
      expect(board.active && board.active.y + 1).toBeGreaterThanOrEqual(HIDDEN_ROWS);
    }
  });

  it('adds an unbreakable floor and shifts the board and active piece upward', () => {
    const board = createBoard('O', 'I');
    board.active = activePiece('O', 0, 3, 8);
    board.grid[BOARD_HEIGHT - 1]![0] = 'I';
    expect(addRisingFloor(board)).toBe(true);
    expect(board.active?.y).toBe(7);
    expect(board.grid[BOARD_HEIGHT - 2]?.[0]).toBe('I');
    expect(board.grid[BOARD_HEIGHT - 1]?.every((cell) => cell === 'garbage')).toBe(true);
  });

  it('adds several gray rows atomically through the shared board operation', () => {
    const board = createBoard('O', 'I');
    board.active = activePiece('O', 0, 3, 8);
    board.grid[BOARD_HEIGHT - 1]![0] = 'I';
    expect(addGrayRows(board, 3)).toBe(true);
    expect(board.active?.y).toBe(5);
    expect(board.grid[BOARD_HEIGHT - 4]?.[0]).toBe('I');
    expect(board.grid.slice(-3).every((row) => row.every((cell) => cell === 'garbage'))).toBe(true);
  });

  it('top-outs partway through a multi-row gray-floor rise', () => {
    const board = createBoard('O', 'I');
    board.grid[1]![0] = 'T';
    expect(addGrayRows(board, 2)).toBe(false);
    expect(board.alive).toBe(false);
  });

  it('removes only contiguous bottom gray rows and restores valid coordinates', () => {
    const board = createBoard('O', 'I');
    board.active = activePiece('O', 0, 3, 7);
    board.grid[BOARD_HEIGHT - 3]![0] = 'J';
    board.grid[BOARD_HEIGHT - 2]?.fill('garbage');
    board.grid[BOARD_HEIGHT - 1]?.fill('garbage');
    const activeY = board.active.y;
    expect(removeBottomGrayRows(board, 4)).toBe(2);
    expect(board.grid).toHaveLength(BOARD_HEIGHT);
    expect(board.grid[BOARD_HEIGHT - 1]?.[0]).toBe('J');
    expect(board.active.y).toBe(activeY + 2);
    expect(canPlace(board.grid, board.active)).toBe(true);
    expect(removeBottomGrayRows(board, 1)).toBe(0);
  });

  it('top-outs when the rising floor pushes settled cells above the board', () => {
    const board = createBoard('O', 'I');
    board.grid[0]![0] = 'T';
    expect(addRisingFloor(board)).toBe(false);
    expect(board.alive).toBe(false);
  });

  it('keeps a near-top active piece legal when the rising floor has no settled overflow', () => {
    const board = createBoard('I', 'O');
    board.active = activePiece('I', 1, 3, 0);
    expect(canPlace(board.grid, board.active)).toBe(true);
    expect(addRisingFloor(board)).toBe(true);
    expect(board.alive).toBe(true);
    expect(board.active).not.toBeNull();
    expect(board.active && canPlace(board.grid, board.active)).toBe(true);
    expect(board.active?.y).toBe(0);
    expect(board.grid[BOARD_HEIGHT - 1]?.every((cell) => cell === 'garbage')).toBe(true);
  });

  it('never clears or counts a complete gray floor row', () => {
    const grid = createEmptyGrid();
    grid[BOARD_HEIGHT - 1]?.fill('garbage');
    grid[BOARD_HEIGHT - 2]?.fill('Z');
    expect(clearCompletedLines(grid)).toBe(1);
    expect(grid[BOARD_HEIGHT - 1]?.every((cell) => cell === 'garbage')).toBe(true);
  });
});
