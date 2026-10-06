import type { MatchVariant, TeamId } from '../domain/types';

const SLOT_COLORS = [0xfff1a8, 0xc9f1f6, 0xead4ff, 0xffd8c9] as const;
const TEAM_COLORS = [0xffefb8, 0xd9eaff] as const;
const ELIMINATED_SLOT_COLORS = [0xe6dfc6, 0xd2e3e5, 0xdfd5e6, 0xe8d9d4] as const;
const ELIMINATED_TEAM_COLORS = [0xe3ddc9, 0xd3ddea] as const;

export function arenaCardColorForParticipant(slotIndex: number, variant: MatchVariant, alive: boolean, teamId?: TeamId): number {
  const paletteIndex = Math.min(3, Math.max(0, slotIndex));
  if (variant === 'teams') {
    const teamIndex = teamId ? (teamId === 'team-1' ? 0 : 1) : paletteIndex < 2 ? 0 : 1;
    return (alive ? TEAM_COLORS : ELIMINATED_TEAM_COLORS)[teamIndex] ?? TEAM_COLORS[0];
  }
  return (alive ? SLOT_COLORS : ELIMINATED_SLOT_COLORS)[paletteIndex] ?? SLOT_COLORS[0];
}
