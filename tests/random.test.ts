import { describe, expect, it } from 'vitest';
import { PieceSequence, SeededRandom } from '../src/simulation/random';

describe('seeded randomness', () => {
  it('repeats the same random stream', () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);
    expect(Array.from({ length: 20 }, () => first.next())).toEqual(Array.from({ length: 20 }, () => second.next()));
  });

  it('builds complete seven-piece bags', () => {
    const sequence = new PieceSequence(99).snapshot(21);
    for (let index = 0; index < sequence.length; index += 7) {
      expect(new Set(sequence.slice(index, index + 7))).toEqual(new Set(['I', 'J', 'L', 'O', 'S', 'T', 'Z']));
    }
  });

  it('serves identical corresponding indices to independent consumers', () => {
    const sequence = new PieceSequence(1234);
    const boardA = Array.from({ length: 30 }, (_, index) => sequence.at(index));
    const boardB = Array.from({ length: 30 }, (_, index) => sequence.at(index));
    expect(boardA).toEqual(boardB);
  });
});
