import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH, HIDDEN_ROWS, type Grid } from '../src/domain/types';
import { activePiece } from '../src/simulation/tetrominoes';
import { LOWER_THIRD_START_ROW, hasLowerThirdLanding, PlayerEventRegionLatch, playerEventRegion } from '../src/ui/playerEventPlacement';

function emptyGrid(): Grid {
  return Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(null));
}

describe('player event placement', () => {
  it('keeps the card above an available lower-third landing', () => {
    expect(hasLowerThirdLanding(emptyGrid(), activePiece('T', 0, 3, HIDDEN_ROWS))).toBe(true);
    expect(playerEventRegion(emptyGrid(), activePiece('T', 0, 3, HIDDEN_ROWS))).toBe('upper');
  });

  it('uses the lower region when the active figure cannot land in the lower third', () => {
    const grid = emptyGrid();
    for (let y = LOWER_THIRD_START_ROW; y < BOARD_HEIGHT; y += 1) grid[y]?.fill('garbage');

    expect(hasLowerThirdLanding(grid, activePiece('O', 0, 3, HIDDEN_ROWS))).toBe(false);
    expect(playerEventRegion(grid, activePiece('O', 0, 3, HIDDEN_ROWS))).toBe('lower');
  });

  it('checks legal rotations rather than only the active orientation', () => {
    const grid = emptyGrid();
    for (let y = LOWER_THIRD_START_ROW; y < BOARD_HEIGHT; y += 1) grid[y]?.fill('garbage');
    for (let y = LOWER_THIRD_START_ROW; y < BOARD_HEIGHT; y += 1) {
      const row = grid[y];
      if (row) row[4] = null;
    }

    expect(hasLowerThirdLanding(grid, activePiece('I', 0, 3, HIDDEN_ROWS))).toBe(true);
  });

  it('uses the lower region when no active figure exists', () => {
    expect(hasLowerThirdLanding(emptyGrid(), null)).toBe(false);
    expect(playerEventRegion(emptyGrid(), null)).toBe('lower');
  });

  it('keeps an event region fixed until that event is released', () => {
    const latch = new PlayerEventRegionLatch();
    const blockedGrid = emptyGrid();
    for (let y = LOWER_THIRD_START_ROW; y < BOARD_HEIGHT; y += 1) blockedGrid[y]?.fill('garbage');
    const active = activePiece('T', 0, 3, HIDDEN_ROWS);

    expect(latch.resolve('p1', 'conflict:1', blockedGrid, active)).toBe('lower');
    expect(latch.resolve('p1', 'conflict:1', emptyGrid(), active)).toBe('lower');
    latch.release('p1');
    expect(latch.resolve('p1', 'conflict:2', emptyGrid(), active)).toBe('upper');
  });
});
