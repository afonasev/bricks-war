import { describe, expect, it } from 'vitest';
import { hudIdentityForParticipant, playerAccentForSlot } from '../src/ui/hudIdentity';

describe('participant HUD identity', () => {
  it('uses one stable palette per free-for-all slot', () => {
    expect([0, 1, 2, 3].map((slot) => hudIdentityForParticipant(slot, 'free-for-all').palette)).toEqual([
      'slot-1', 'slot-2', 'slot-3', 'slot-4',
    ]);
  });

  it('groups fixed teammates by palette and label', () => {
    expect([0, 1, 2, 3].map((slot) => hudIdentityForParticipant(slot, 'teams'))).toEqual([
      { palette: 'team-1', teamLabel: 'СОЛНЦЕ' },
      { palette: 'team-1', teamLabel: 'СОЛНЦЕ' },
      { palette: 'team-2', teamLabel: 'НЕБО' },
      { palette: 'team-2', teamLabel: 'НЕБО' },
    ]);
    expect(new Set([0, 1, 2, 3].map(playerAccentForSlot)).size).toBe(4);
  });
});
