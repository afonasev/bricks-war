import type { PieceDefinition } from '../domain/types';

export function nextPiecePreviewMarkup(definition: PieceDefinition): string {
  const shape = definition.rotations[0] ?? [];
  const minX = Math.min(...shape.map((cell) => cell.x));
  const minY = Math.min(...shape.map((cell) => cell.y));
  const width = Math.max(...shape.map((cell) => cell.x)) - minX + 1;
  const height = Math.max(...shape.map((cell) => cell.y)) - minY + 1;
  const cellSize = 15;
  const color = definition.source === 'anomaly'
    ? '#e216a9'
    : ({ I: '#15c8ff', J: '#3a78d4', L: '#ff8a36', O: '#ffd21f', S: '#75cf8d', T: '#a355d5', Z: '#e55c6d' }[definition.classicKind ?? 'T']);
  const cells = shape.map((cell) => (
    `<i class="hud-next-cell${definition.source === 'anomaly' ? ' is-anomaly' : ''}" style="--x:${cell.x - minX};--y:${cell.y - minY};--cell:${cellSize}px;--piece-color:${color}"></i>`
  )).join('');
  return `<span class="hud-next-piece" aria-label="Следующая фигура" style="--preview-width:${width * cellSize}px;--preview-height:${height * cellSize}px">${cells}</span>`;
}
