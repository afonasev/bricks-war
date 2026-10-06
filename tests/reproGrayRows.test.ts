import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH } from '../src/domain/types';
import { addGrayRows, canPlace, createBoard } from '../src/simulation/board';
import { pieceDefinition } from '../src/simulation/tetrominoes';

function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

describe('gray-row repro search', () => {
  it('shows that four rows can top out a sparse board with a high column', () => {
    const next = random(0x6a09e667);
    const shapes = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'] as const;
    let found: { seed: number; kind: string; x: number; y: number; rotation: number; occupied: number } | null = null;
    for (let seed = 0; seed < 20_000 && !found; seed += 1) {
      const board = createBoard('O', 'I');
      for (let y = 2; y < BOARD_HEIGHT - 1; y += 1) {
        for (let x = 0; x < BOARD_WIDTH; x += 1) {
          if (next() < 0.19) board.grid[y]![x] = 'J';
        }
      }
      const definition = pieceDefinition(shapes[Math.floor(next() * shapes.length)]!);
      const candidate = { definition, rotation: Math.floor(next() * 4) as 0 | 1 | 2 | 3, x: Math.floor(next() * BOARD_WIDTH), y: Math.floor(next() * 5) };
      if (!canPlace(board.grid, candidate)) continue;
      board.active = candidate;
      const occupied = board.grid.flat().filter(Boolean).length;
      if (occupied >= (BOARD_HEIGHT * BOARD_WIDTH) / 2) continue;
      if (!addGrayRows(board, 4)) found = { seed, kind: definition.id, x: candidate.x, y: candidate.y, rotation: candidate.rotation, occupied };
    }
    expect(found).toMatchObject({ occupied: 49, kind: 'classic-L', x: 3, y: 4, rotation: 3 });
  });
});
