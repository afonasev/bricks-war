import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  HIDDEN_ROWS,
  type ActivePiece,
  type BoardState,
  type Cell,
  type Grid,
  type PieceDefinition,
  type TetrominoKind,
} from '../domain/types';
import { nextPieceRotation, pieceBounds, pieceCells, pieceDefinition, rotationKicks } from './tetrominoes';

export function createEmptyGrid(): Grid {
  return Array.from({ length: BOARD_HEIGHT }, () => Array<Cell>(BOARD_WIDTH).fill(null));
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

export function createBoard(firstKind: TetrominoKind, nextKind: TetrominoKind, preparationMs = 0): BoardState {
  const board: BoardState = {
    grid: createEmptyGrid(),
    active: null,
    nextPiece: pieceDefinition(nextKind),
    regularPieceIndex: 1,
    spawnSerial: 0,
    staticRenderRevision: 0,
    pendingAnomalies: [],
    gravityElapsedMs: 0,
    softDropElapsedMs: 0,
    lockElapsedMs: 0,
    lockResets: 0,
    preparationRemainingMs: 0,
    preparationElapsedMs: 0,
    maneuverRemainingMs: 0,
    maneuverSpentMs: 0,
    maneuverCancelled: false,
    clearFlashMs: 0,
    softDrop: false,
    alive: true,
  };
  spawnPiece(board, firstKind, preparationMs);
  return board;
}

export function spawnPiece(board: BoardState, input: TetrominoKind | PieceDefinition, preparationMs = 0): boolean {
  const definition = pieceDefinition(input);
  const { width } = pieceBounds(definition);
  const piece: ActivePiece = {
    definition,
    rotation: 0,
    x: definition.source === 'classic' ? 3 : Math.floor((BOARD_WIDTH - width) / 2),
    y: HIDDEN_ROWS - 1,
  };
  if (!canPlace(board.grid, piece)) {
    board.active = null;
    board.alive = false;
    board.staticRenderRevision += 1;
    return false;
  }
  board.active = piece;
  board.spawnSerial += 1;
  board.gravityElapsedMs = 0;
  board.softDropElapsedMs = 0;
  board.lockElapsedMs = 0;
  board.lockResets = 0;
  board.preparationRemainingMs = Math.max(0, preparationMs);
  board.preparationElapsedMs = 0;
  board.maneuverRemainingMs = 0;
  board.maneuverSpentMs = 0;
  board.maneuverCancelled = false;
  board.softDrop = false;
  return true;
}

export function canPlace(grid: Grid, piece: ActivePiece): boolean {
  return pieceCells(piece).every(({ x, y }) => (
    x >= 0
    && x < BOARD_WIDTH
    && y >= 0
    && y < BOARD_HEIGHT
    && grid[y]?.[x] === null
  ));
}

export function tryMove(board: BoardState, dx: number, dy: number): boolean {
  if (!board.active || !board.alive) return false;
  const candidate = { ...board.active, x: board.active.x + dx, y: board.active.y + dy };
  if (!canPlace(board.grid, candidate)) return false;
  board.active = candidate;
  return true;
}

export function tryRotateClockwise(board: BoardState): boolean {
  const active = board.active;
  if (!active || !board.alive) return false;
  const rotation = nextPieceRotation(active.definition, active.rotation);
  for (const kick of rotationKicks(active.definition, active.rotation)) {
    const candidate: ActivePiece = {
      ...active,
      rotation,
      x: active.x + kick.x,
      y: active.y + kick.y,
    };
    if (canPlace(board.grid, candidate)) {
      board.active = candidate;
      return true;
    }
  }
  return false;
}

export function landingPiece(grid: Grid, piece: ActivePiece): ActivePiece | null {
  if (!canPlace(grid, piece)) return null;
  const landed = { ...piece };
  while (canPlace(grid, { ...landed, y: landed.y + 1 })) landed.y += 1;
  return landed;
}

export function lockPiece(board: BoardState, deferClear = false): number {
  if (!board.active) return 0;
  for (const { x, y } of pieceCells(board.active)) {
    const row = board.grid[y];
    if (row) row[x] = board.active.definition.settledKind;
  }
  board.active = null;
  board.staticRenderRevision += 1;
  return deferClear
    ? board.grid.filter((row) => row.every((cell) => cell !== null && cell !== 'garbage')).length
    : clearCompletedLines(board.grid);
}

export function clearCompletedLines(grid: Grid): number {
  let cleared = 0;
  for (let y = grid.length - 1; y >= 0; y -= 1) {
    if (grid[y]?.every((cell) => cell !== null && cell !== 'garbage')) {
      grid.splice(y, 1);
      grid.unshift(Array<Cell>(BOARD_WIDTH).fill(null));
      cleared += 1;
      y += 1;
    }
  }
  return cleared;
}

export function addRisingFloor(board: BoardState): boolean {
  return addGrayRows(board, 1);
}

function closestLegalRaisedPiece(grid: Grid, active: ActivePiece): ActivePiece | null {
  const raisedY = active.y - 1;
  const candidates = Array.from({ length: BOARD_HEIGHT + 4 }, (_, yIndex) => yIndex - 3)
    .flatMap((y) => Array.from({ length: BOARD_WIDTH + 6 }, (_, xIndex) => ({ x: xIndex - 3, y })))
    .sort((left, right) => (
      Math.abs(left.y - raisedY) + Math.abs(left.x - active.x)
      - Math.abs(right.y - raisedY) - Math.abs(right.x - active.x)
    ));
  for (const { x, y } of candidates) {
    const candidate = { ...active, x, y };
    if (canPlace(grid, candidate)) return candidate;
  }
  return null;
}

function reportGrayRowTopOut(
  board: BoardState,
  reason: 'settled-overflow' | 'active-piece-no-placement',
  requestedRows: number,
  rowIndex: number,
  grid: Grid = board.grid,
): void {
  const active = board.active;
  console.warn('[Bricks War] gray-row top-out', {
    reason,
    requestedRows,
    rowIndex: rowIndex + 1,
    occupiedCells: grid.flat().filter((cell) => cell !== null).length,
    active: active && {
      id: active.definition.id,
      source: active.definition.source,
      rotation: active.rotation,
      x: active.x,
      y: active.y,
    },
    topRows: grid.slice(0, HIDDEN_ROWS + 6).map((row) => [...row]),
  });
}

export function addGrayRows(board: BoardState, count: number): boolean {
  if (!board.alive) return false;
  const rows = Math.max(0, Math.floor(count));
  for (let index = 0; index < rows; index += 1) {
    if (board.grid[0]?.some((cell) => cell !== null)) {
      reportGrayRowTopOut(board, 'settled-overflow', rows, index);
      board.active = null;
      board.alive = false;
      board.staticRenderRevision += 1;
      return false;
    }

    const shiftedGrid: Grid = board.grid.slice(1).map((row) => [...row]);
    shiftedGrid.push(Array<Cell>(BOARD_WIDTH).fill('garbage'));
    const shiftedActive = board.active ? closestLegalRaisedPiece(shiftedGrid, board.active) : null;
    if (board.active && !shiftedActive) {
      reportGrayRowTopOut(board, 'active-piece-no-placement', rows, index, shiftedGrid);
      board.active = null;
      board.alive = false;
      board.staticRenderRevision += 1;
      return false;
    }
    board.grid = shiftedGrid;
    board.active = shiftedActive;
    board.staticRenderRevision += 1;
  }
  board.lockElapsedMs = 0;
  return true;
}

export function removeBottomGrayRows(board: BoardState, count: number): number {
  if (!board.alive) return 0;
  const limit = Math.max(0, Math.floor(count));
  let removed = 0;
  while (
    removed < limit
    && board.grid.at(-1)?.every((cell) => cell === 'garbage')
  ) {
    board.grid.pop();
    board.grid.unshift(Array<Cell>(BOARD_WIDTH).fill(null));
    if (board.active) board.active = { ...board.active, y: board.active.y + 1 };
    removed += 1;
  }
  if (removed > 0) {
    board.lockElapsedMs = 0;
    board.staticRenderRevision += 1;
  }
  return removed;
}

/** Removes and returns the lowest rows regardless of their cell kinds. */
export function burnBottomRows(board: BoardState, count: number): Cell[][] {
  if (!board.alive) return [];
  const rows = Math.min(BOARD_HEIGHT, Math.max(0, Math.floor(count)));
  const burned = board.grid.slice(BOARD_HEIGHT - rows).map((row) => [...row]);
  if (burned.length === 0) return burned;
  board.grid.splice(BOARD_HEIGHT - burned.length, burned.length);
  board.grid.unshift(...Array.from({ length: burned.length }, () => Array<Cell>(BOARD_WIDTH).fill(null)));
  if (board.active) board.active = { ...board.active, y: board.active.y + burned.length };
  board.lockElapsedMs = 0;
  board.staticRenderRevision += 1;
  return burned;
}

export function placeAndClear(grid: Grid, piece: ActivePiece): { grid: Grid; lines: number } | null {
  const landed = landingPiece(grid, piece);
  if (!landed) return null;
  const copy = cloneGrid(grid);
  for (const { x, y } of pieceCells(landed)) {
    const row = copy[y];
    if (row) row[x] = landed.definition.settledKind;
  }
  return { grid: copy, lines: clearCompletedLines(copy) };
}
