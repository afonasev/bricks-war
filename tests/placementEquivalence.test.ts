import { expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH, type ActivePiece, type Grid, type Rotation, type TetrominoKind } from '../src/domain/types';
import { canPlace, createEmptyGrid, landingPiece } from '../src/simulation/board';
import { pieceCells, pieceDefinition } from '../src/simulation/tetrominoes';
import { generateAnomaly } from '../src/simulation/anomaly';

// Independent pre-optimization reference, including bounds and null semantics.
function referenceCanPlace(grid: Grid, piece: ActivePiece): boolean {
  return pieceCells(piece).every(({ x, y }) => x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT && grid[y]?.[x] === null);
}
function referenceLanding(grid: Grid, piece: ActivePiece): ActivePiece | null {
  if (!referenceCanPlace(grid, piece)) return null;
  const landed = { ...piece };
  while (referenceCanPlace(grid, { ...landed, y: landed.y + 1 })) landed.y += 1;
  return landed;
}

it.each([0, 1, 2])('preserves collision and landing results without mutating inputs, grid fixture %s', (fixture) => {
  const grid = createEmptyGrid();
  for (let y = 8; y < BOARD_HEIGHT; y += 1) {
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      if (fixture === 1 && (x * 7 + y * 3) % 11 < 4) grid[y]![x] = 'T';
      if (fixture === 2 && (x + y) % 4 !== 0) grid[y]![x] = 'garbage';
    }
  }
  const originalGrid = structuredClone(grid);
  const definitions = [
    ...(['I', 'J', 'L', 'O', 'S', 'T', 'Z'] as TetrominoKind[]).map(pieceDefinition),
    ...Array.from({ length: 16 }, (_, index) => generateAnomaly(10000 + index, 1)),
  ];
  for (const definition of definitions) {
    const actual: unknown[] = [], expected: unknown[] = [];
    for (let rotation = 0; rotation < 4; rotation += 1) {
      for (let x = -4; x <= BOARD_WIDTH + 1; x += 1) {
        for (const y of [-2, 0, 3, 10, BOARD_HEIGHT - 2, BOARD_HEIGHT]) {
          const piece: ActivePiece = { definition, rotation: rotation as Rotation, x, y };
          const before = { ...piece };
          const landed = landingPiece(grid, piece);
          actual.push([canPlace(grid, piece), landed]);
          expected.push([referenceCanPlace(grid, piece), referenceLanding(grid, piece)]);
          expect(piece).toEqual(before);
          if (landed) expect(landed).not.toBe(piece);
        }
      }
    }
    expect(actual).toEqual(expected);
  }
  expect(grid).toEqual(originalGrid);
});
