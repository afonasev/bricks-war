import type { MatchVariant } from '../domain/types';

export interface HudIdentity {
  palette: 'slot-1' | 'slot-2' | 'slot-3' | 'slot-4' | 'team-1' | 'team-2';
  teamLabel: string | null;
}

const PLAYER_ACCENTS = ['#355f0a', '#087080', '#74349a', '#a9432b'] as const;

export function playerAccentForSlot(slotIndex: number): string {
  return PLAYER_ACCENTS[Math.min(3, Math.max(0, slotIndex))] ?? PLAYER_ACCENTS[0];
}

export function hudIdentityForParticipant(slotIndex: number, variant: MatchVariant): HudIdentity {
  if (variant === 'teams') {
    const firstTeam = slotIndex < 2;
    return { palette: firstTeam ? 'team-1' : 'team-2', teamLabel: firstTeam ? 'СОЛНЦЕ' : 'НЕБО' };
  }
  const palette = (`slot-${Math.min(4, Math.max(1, slotIndex + 1))}`) as HudIdentity['palette'];
  return { palette, teamLabel: null };
}
