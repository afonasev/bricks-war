import type { TetrominoKind } from '../domain/types';

const BAG: readonly TetrominoKind[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  checkpoint(): number { return this.state; }
  restore(state: number): void { this.state = state >>> 0; }
}

export class PieceSequence {
  private readonly random: SeededRandom;
  private readonly pieces: TetrominoKind[] = [];

  constructor(seed: number) {
    this.random = new SeededRandom(seed);
  }

  at(index: number): TetrominoKind {
    while (this.pieces.length <= index) {
      this.appendBag();
    }
    return this.pieces[index] as TetrominoKind;
  }

  snapshot(length: number): TetrominoKind[] {
    if (length > 0) this.at(length - 1);
    return this.pieces.slice(0, length);
  }

  checkpoint(): { randomState: number; pieces: TetrominoKind[] } {
    return { randomState: this.random.checkpoint(), pieces: [...this.pieces] };
  }

  restore(checkpoint: ReturnType<PieceSequence['checkpoint']>): void {
    this.random.restore(checkpoint.randomState);
    this.pieces.splice(0, this.pieces.length, ...checkpoint.pieces);
  }

  private appendBag(): void {
    const bag = [...BAG];
    for (let index = bag.length - 1; index > 0; index -= 1) {
      const swapIndex = this.random.int(index + 1);
      [bag[index], bag[swapIndex]] = [bag[swapIndex] as TetrominoKind, bag[index] as TetrominoKind];
    }
    this.pieces.push(...bag);
  }
}

export function deriveSeed(seed: number, salt: string): number {
  let hash = seed >>> 0;
  for (let index = 0; index < salt.length; index += 1) {
    hash ^= salt.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
