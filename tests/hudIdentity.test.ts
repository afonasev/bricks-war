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
      { palette: 'team-1', teamLabel: null },
      { palette: 'team-1', teamLabel: null },
      { palette: 'team-2', teamLabel: null },
      { palette: 'team-2', teamLabel: null },
    ]);
    expect(hudIdentityForParticipant(0, 'teams', 'en', 'team-2').palette).toBe('team-2');
    expect(hudIdentityForParticipant(3, 'teams', 'en', 'team-1').palette).toBe('team-1');
    expect(new Set([0, 1, 2, 3].map(playerAccentForSlot)).size).toBe(4);
  });
});
