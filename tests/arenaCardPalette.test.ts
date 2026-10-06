import { describe, expect, it } from 'vitest';
import { arenaCardColorForParticipant } from '../src/rendering/arenaCardPalette';

describe('arena card palette', () => {
  it('gives every free-for-all slot its own card colour', () => {
    expect([0, 1, 2, 3].map((slot) => arenaCardColorForParticipant(slot, 'free-for-all', true))).toEqual([
      0xfff1a8, 0xc9f1f6, 0xead4ff, 0xffd8c9,
    ]);
  });

  it('groups teammates by a shared card colour', () => {
    expect([0, 1, 2, 3].map((slot) => arenaCardColorForParticipant(slot, 'teams', true))).toEqual([
      0xffefb8, 0xffefb8, 0xd9eaff, 0xd9eaff,
    ]);
  });

  it('keeps eliminated cards visibly muted without losing their team grouping', () => {
    expect(arenaCardColorForParticipant(0, 'teams', false)).toBe(arenaCardColorForParticipant(1, 'teams', false));
    expect(arenaCardColorForParticipant(0, 'teams', false)).not.toBe(arenaCardColorForParticipant(2, 'teams', false));
  });
});
