import type { PieceDefinition, Position, TetrominoKind } from '../domain/types';
import { deriveSeed, SeededRandom } from './random';
import { CLASSIC_PIECES } from './tetrominoes';

const CLASSIC_KINDS: readonly TetrominoKind[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
const ORTHOGONAL_NEIGHBORS: readonly Position[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

export function normalizeCells(cells: readonly Position[]): Position[] {
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  return cells
    .map((cell) => ({ x: cell.x - minX, y: cell.y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function rotateCells(cells: readonly Position[]): Position[] {
  return normalizeCells(cells.map((cell) => ({ x: -cell.y, y: cell.x })));
}

function rawSignature(cells: readonly Position[]): string {
  return normalizeCells(cells).map(positionKey).join(';');
}

export function distinctRotations(cells: readonly Position[]): Position[][] {
  const rotations: Position[][] = [];
  let current = normalizeCells(cells);
  for (let index = 0; index < 4; index += 1) {
    const signature = rawSignature(current);
    if (!rotations.some((rotation) => rawSignature(rotation) === signature)) rotations.push(current);
    current = rotateCells(current);
  }
  return rotations;
}

export function canonicalShapeSignature(cells: readonly Position[]): string {
  return distinctRotations(cells).map(rawSignature).sort()[0] ?? '';
}

export function shapeBounds(cells: readonly Position[]): { width: number; height: number } {
  const normalized = normalizeCells(cells);
  return {
    width: Math.max(...normalized.map((cell) => cell.x)) + 1,
    height: Math.max(...normalized.map((cell) => cell.y)) + 1,
  };
}

export function isValidAnomaly(cells: readonly Position[]): boolean {
  if (cells.length < 6 || cells.length > 8) return false;
  if (new Set(cells.map(positionKey)).size !== cells.length) return false;
  const { width, height } = shapeBounds(cells);
  return width <= 5 && height <= 5 && width > 1 && height > 1 && width * height !== cells.length;
}

function frontier(cells: readonly Position[]): Position[] {
  const occupied = new Set(cells.map(positionKey));
  const candidates = new Map<string, Position>();
  for (const cell of cells) {
    for (const offset of ORTHOGONAL_NEIGHBORS) {
      const next = { x: cell.x + offset.x, y: cell.y + offset.y };
      const key = positionKey(next);
      if (!occupied.has(key)) candidates.set(key, next);
    }
  }
  return [...candidates.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

interface CatalogEntry {
  base: TetrominoKind;
  cells: Position[];
  signature: string;
}

function buildCatalog(): CatalogEntry[] {
  const unique = new Map<string, CatalogEntry>();
  for (const base of CLASSIC_KINDS) {
    let shapes = [normalizeCells(CLASSIC_PIECES[base].rotations[0] ?? [])];
    for (let additions = 1; additions <= 4; additions += 1) {
      const expanded = new Map<string, Position[]>();
      for (const shape of shapes) {
        for (const next of frontier(shape)) {
          const candidate = normalizeCells([...shape, next]);
          expanded.set(rawSignature(candidate), candidate);
        }
      }
      shapes = [...expanded.values()];
      if (additions >= 2) {
        for (const cells of shapes) {
          if (!isValidAnomaly(cells)) continue;
          const signature = canonicalShapeSignature(cells);
          if (!unique.has(signature)) unique.set(signature, { base, cells, signature });
        }
      }
    }
  }
  return [...unique.values()].sort((a, b) => a.signature.localeCompare(b.signature));
}

let cachedCatalog: CatalogEntry[] | null = null;
const generatedBySeed = new Map<number, PieceDefinition[]>();

export function anomalyCandidateCount(): number {
  cachedCatalog ??= buildCatalog();
  return cachedCatalog.length;
}

function seededCatalog(seed: number): CatalogEntry[] {
  cachedCatalog ??= buildCatalog();
  const shuffled = [...cachedCatalog];
  const random = new SeededRandom(deriveSeed(seed, 'anomaly-catalog'));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random.next() * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[target];
    if (current && replacement) {
      shuffled[index] = replacement;
      shuffled[target] = current;
    }
  }
  return shuffled;
}

function randomCandidate(seed: number, level: number, attempt: number): CatalogEntry | null {
  const random = new SeededRandom(deriveSeed(seed, `anomaly:${level}:${attempt}`));
  const base = CLASSIC_KINDS[random.int(CLASSIC_KINDS.length)];
  if (!base) return null;
  const additions = 2 + random.int(3);
  let cells = normalizeCells(CLASSIC_PIECES[base].rotations[0] ?? []);
  for (let index = 0; index < additions; index += 1) {
    const options = frontier(cells);
    const next = options[random.int(options.length)];
    if (!next) return null;
    cells = normalizeCells([...cells, next]);
  }
  if (!isValidAnomaly(cells)) return null;
  return { base, cells, signature: canonicalShapeSignature(cells) };
}

function definitionFor(seed: number, level: number, entry: CatalogEntry): PieceDefinition {
  const suffix = deriveSeed(seed, `${level}:${entry.base}:${entry.signature}`).toString(16).padStart(8, '0');
  return {
    id: `anomaly-${level}-${suffix}`,
    source: 'anomaly',
    rotations: distinctRotations(entry.cells),
    settledKind: 'anomaly',
  };
}

export function generateAnomaly(seed: number, level: number): PieceDefinition {
  const targetLevel = Math.max(1, Math.floor(level));
  const generated = generatedBySeed.get(seed) ?? [];
  const catalog = seededCatalog(seed);
  while (generated.length < targetLevel) {
    const currentLevel = generated.length + 1;
    const used = new Set(generated.map((definition) => canonicalShapeSignature(definition.rotations[0] ?? [])));
    let entry: CatalogEntry | null = null;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const candidate = randomCandidate(seed, currentLevel, attempt);
      if (candidate && !used.has(candidate.signature)) {
        entry = candidate;
        break;
      }
    }
    entry ??= catalog.find((candidate) => !used.has(candidate.signature)) ?? null;
    if (!entry) throw new Error('Anomaly catalog exhausted');
    generated.push(definitionFor(seed, currentLevel, entry));
  }
  generatedBySeed.set(seed, generated);
  const result = generated[targetLevel - 1];
  if (!result) throw new Error('Failed to generate anomaly');
  return result;
}
