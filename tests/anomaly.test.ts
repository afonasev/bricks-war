import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH } from '../src/domain/types';
import { canPlace, clearCompletedLines, createBoard, lockPiece, spawnPiece, tryRotateClockwise } from '../src/simulation/board';
import {
  anomalyCandidateCount,
  canonicalShapeSignature,
  distinctRotations,
  generateAnomaly,
  isValidAnomaly,
  shapeBounds,
} from '../src/simulation/anomaly';
import { MAX_REACHABLE_GRAVITY_LEVELS } from '../src/simulation/match';
import { ANOMALY_COLOR, pieceCells, pieceColor } from '../src/simulation/tetrominoes';

describe('level-up anomaly shapes', () => {
  it('generates deterministic valid 6–8-cell shapes for a seed and level', () => {
    for (let level = 1; level <= 24; level += 1) {
      const first = generateAnomaly(0xabc123, level);
      const second = generateAnomaly(0xabc123, level);
      expect(first).toEqual(second);
      expect(first.rotations[0] && isValidAnomaly(first.rotations[0])).toBe(true);
      expect(first.rotations[0]?.length).toBeGreaterThanOrEqual(6);
      expect(first.rotations[0]?.length).toBeLessThanOrEqual(8);
      const bounds = shapeBounds(first.rotations[0] ?? []);
      expect(bounds.width).toBeLessThanOrEqual(5);
      expect(bounds.height).toBeLessThanOrEqual(5);
    }
  });

  it('has enough unique rotation-invariant candidates for a ten-minute match', () => {
    expect(anomalyCandidateCount()).toBeGreaterThan(MAX_REACHABLE_GRAVITY_LEVELS);
    const signatures = Array.from({ length: MAX_REACHABLE_GRAVITY_LEVELS }, (_, index) => (
      canonicalShapeSignature(generateAnomaly(98765, index + 1).rotations[0] ?? [])
    ));
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('normalizes and removes duplicate rotations', () => {
    const square = [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 5 }, { x: 4, y: 5 }];
    expect(distinctRotations(square)).toHaveLength(1);
    const anomaly = generateAnomaly(19, 1);
    expect(new Set(anomaly.rotations.map(canonicalShapeSignature)).size).toBe(1);
    expect(new Set(anomaly.rotations.map((rotation) => JSON.stringify(rotation))).size).toBe(anomaly.rotations.length);
  });

  it('spawns centered, rotates legally, and keeps classic wall behavior isolated', () => {
    const board = createBoard('T', 'I');
    const anomaly = generateAnomaly(41, 3);
    expect(spawnPiece(board, anomaly)).toBe(true);
    const active = board.active;
    expect(active).not.toBeNull();
    expect(active && canPlace(board.grid, active)).toBe(true);
    const bounds = shapeBounds(anomaly.rotations[0] ?? []);
    expect(active?.x).toBe(Math.floor((BOARD_WIDTH - bounds.width) / 2));
    if (board.active) board.active.x = 0;
    expect(tryRotateClockwise(board)).toBe(true);
    expect(board.active && canPlace(board.grid, board.active)).toBe(true);
  });

  it('rejects a crowded rotation without moving the anomaly illegally', () => {
    const board = createBoard('T', 'I');
    const anomaly = generateAnomaly(144, 1);
    board.active = { definition: anomaly, rotation: 0, x: 2, y: 8 };
    board.grid.forEach((row) => row.fill('J'));
    for (const cell of pieceCells(board.active)) board.grid[cell.y]![cell.x] = null;
    const before = { ...board.active };
    expect(tryRotateClockwise(board)).toBe(false);
    expect(board.active).toEqual(before);
  });

  it('settles in neon magenta and clears like ordinary blocks, never like garbage', () => {
    const board = createBoard('T', 'I');
    const anomaly = generateAnomaly(91, 2);
    board.active = {
      definition: anomaly,
      rotation: 0,
      x: 2,
      y: BOARD_HEIGHT - shapeBounds(anomaly.rotations[0] ?? []).height,
    };
    lockPiece(board);
    expect(board.grid.flat().filter((cell) => cell === 'anomaly')).toHaveLength(anomaly.rotations[0]?.length ?? 0);
    expect(pieceColor(anomaly)).toBe(ANOMALY_COLOR);

    const row = board.grid[BOARD_HEIGHT - 1];
    row?.fill('anomaly');
    expect(clearCompletedLines(board.grid)).toBe(1);
    board.grid[BOARD_HEIGHT - 1]?.fill('garbage');
    expect(clearCompletedLines(board.grid)).toBe(0);
  });
});
