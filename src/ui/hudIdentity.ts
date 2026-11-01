import type { Locale } from '../i18n/locale';
import type { MatchVariant, TeamId } from '../domain/types';

export interface HudIdentity {
  palette: 'slot-1' | 'slot-2' | 'slot-3' | 'slot-4' | 'team-1' | 'team-2';
  teamLabel: string | null;
}

const PLAYER_ACCENTS = ['#355f0a', '#087080', '#74349a', '#a9432b'] as const;

export function playerAccentForSlot(slotIndex: number): string {
  return PLAYER_ACCENTS[Math.min(3, Math.max(0, slotIndex))] ?? PLAYER_ACCENTS[0];
}

export function hudIdentityForParticipant(slotIndex: number, variant: MatchVariant, _locale: Locale = 'ru', teamId?: TeamId): HudIdentity {
  if (variant === 'teams') {
    const firstTeam = teamId ? teamId === 'team-1' : slotIndex < 2;
    return { palette: firstTeam ? 'team-1' : 'team-2', teamLabel: null };
  }
  const palette = (`slot-${Math.min(4, Math.max(1, slotIndex + 1))}`) as HudIdentity['palette'];
  return { palette, teamLabel: null };
}
