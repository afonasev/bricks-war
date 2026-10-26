import { describe, expect, it } from 'vitest';
import { nextPiecePreviewMarkup } from '../src/ui/nextPiecePreview';
import { generateAnomaly } from '../src/simulation/anomaly';
import { pieceDefinition } from '../src/simulation/tetrominoes';
import type { PieceDefinition } from '../src/domain/types';

function geometry(definition: PieceDefinition) {
  const markup = nextPiecePreviewMarkup(definition);
  const width = Number(/--preview-width:([\d.]+)px/.exec(markup)![1]);
  const height = Number(/--preview-height:([\d.]+)px/.exec(markup)![1]);
  const cells = [...markup.matchAll(/--x:([\d.-]+);--y:([\d.-]+);--cell:([\d.]+)px/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), size: Number(m[3]) }));
  return { width, height, cells, markup };
}

describe('next-piece preview envelope', () => {
  it('retains every generated anomaly cell inside a 60x30 preview with square proportions', () => {
    for (let seed = 0; seed < 100; seed++) {
      const definition = generateAnomaly(seed, 1);
      const { width, height, cells } = geometry(definition);
      expect(width).toBeLessThanOrEqual(60);
      expect(height).toBeLessThanOrEqual(30);
      expect(cells).toHaveLength(definition.rotations[0]!.length);
      for (const cell of cells) {
        expect(cell.size).toBeGreaterThan(0);
        expect(cell.size).toBeLessThanOrEqual(15);
        expect(cell.x * cell.size).toBeGreaterThanOrEqual(0);
        expect(cell.y * cell.size).toBeGreaterThanOrEqual(0);
        expect((cell.x + 1) * cell.size).toBeLessThanOrEqual(width + 1e-9);
        expect((cell.y + 1) * cell.size).toBeLessThanOrEqual(height + 1e-9);
      }
      expect(new Set(cells.map(cell => cell.size)).size).toBe(1);
    }
  });

  it.each(['I', 'J', 'L', 'O', 'S', 'T', 'Z'] as const)('keeps classic %s at its existing cell size', kind => {
    const { cells } = geometry(pieceDefinition(kind));
    expect(cells).toHaveLength(4);
    expect(cells.every(cell => cell.size === 15)).toBe(true);
  });

  it('normalizes non-zero shape origins and retains all cells without clipping', () => {
    const definition = generateAnomaly(4217, 1);
    definition.rotations = definition.rotations.map(shape => shape.map(cell => ({ x: cell.x + 7, y: cell.y - 3 })));
    const preview = geometry(definition);
    expect(Math.min(...preview.cells.map(cell => cell.x))).toBe(0);
    expect(Math.min(...preview.cells.map(cell => cell.y))).toBe(0);
    expect(preview.width).toBeLessThanOrEqual(60);
    expect(preview.height).toBeLessThanOrEqual(30);
    expect(preview.markup).toContain('is-anomaly');
    expect(preview.markup).toContain('Следующая фигура');
  });
});
