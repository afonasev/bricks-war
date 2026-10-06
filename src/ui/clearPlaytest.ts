import { BOARD_HEIGHT, BOARD_WIDTH, type BoardState, type PieceDefinition } from '../domain/types';

/** Local-only scenario that locks through the real match engine after countdown. */
export function prepareClearPlaytest(board: BoardState, mode: 'normal' | 'fire', lines: number, leadInMs = 0): void {
  if (!Number.isInteger(lines) || lines < 1 || lines > 4) return;
  for (const row of board.grid) row.fill(null);
  const colors = ['J', 'L', 'S', 'T'] as const;
  for (let y = BOARD_HEIGHT - lines - 12; y < BOARD_HEIGHT - lines; y += 1) {
    if (y < 0) continue;
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      if (x === 4) continue;
      const ridge = [8, 10, 9, 12, 8, 7, 11, 9, 10, 0][x] ?? 0;
      if (y >= BOARD_HEIGHT - lines - ridge) board.grid[y]![x] = colors[(x + y + BOARD_HEIGHT * 8) % colors.length]!;
    }
  }
  for (let y = BOARD_HEIGHT - lines; y < BOARD_HEIGHT; y += 1) {
    board.grid[y]!.fill('J');
    board.grid[y]![4] = null;
  }
  const definition: PieceDefinition = {
    id: `playtest-clear-${mode}-${lines}`,
    source: mode === 'fire' ? 'anomaly' : 'classic',
    settledKind: mode === 'fire' ? 'anomaly' : 'I',
    rotations: [
      [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
    ],
  };
  board.active = { definition, rotation: 0, x: 4, y: BOARD_HEIGHT - 4 };
  board.preparationRemainingMs = Math.max(0, leadInMs);
  board.lockElapsedMs = leadInMs > 0 ? 0 : 500;
  board.staticRenderRevision += 1;
}
