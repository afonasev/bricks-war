import type { MatchOptionSelections, ParticipantConfig } from '../domain/types';
import { DEFAULT_MATCH_OPTION_SELECTIONS } from '../simulation/matchOptions';
import type { NetworkMode, RoomRules } from './protocol';
export const NETWORK_MODES: readonly NetworkMode[] = ['survival', 'battle', 'team-battle'];
export const MODE_LABELS: Record<NetworkMode, string> = { survival: 'Выживание', battle: 'Битва', 'team-battle': 'Командный бой' };
export type ResolvedRoomRules = MatchOptionSelections & {mode: NetworkMode; durationMinutes: number};
export function defaultRoomRules(mode: NetworkMode = 'survival'): ResolvedRoomRules {
  return { ...DEFAULT_MATCH_OPTION_SELECTIONS, mode, durationMinutes: 5, battleTimeMode: 'until-victory', conflictEnabled: mode !== 'survival', matchVariant: mode === 'team-battle' ? 'teams' : 'free-for-all' };
}
const choices = { mode: NETWORK_MODES, battleDifficulty: ['family','normal','sport'], softDrop: ['slow','fast','very-fast'], pressure: ['fixed','automatic','extended'], battleTimeMode: ['timed','until-victory'], conflictTargeting: ['all-opponents','hunt-leader'], matchVariant: ['free-for-all','teams'] };
export function normalizeRoomRules(value: unknown): ResolvedRoomRules | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  for (const [key, allowed] of Object.entries(choices)) if (r[key] !== undefined && !(allowed as readonly unknown[]).includes(r[key])) return null;
  if (r.conflictEnabled !== undefined && typeof r.conflictEnabled !== 'boolean') return null;
  if (r.durationMinutes !== undefined && (!Number.isInteger(r.durationMinutes) || Number(r.durationMinutes)<2 || Number(r.durationMinutes)>10)) return null;
  const result = defaultRoomRules((r.mode ?? 'survival') as NetworkMode);
  for (const key of [...Object.keys(choices), 'conflictEnabled', 'durationMinutes']) if (r[key] !== undefined) Object.assign(result, {[key]:r[key]});
  result.matchVariant = result.mode === 'team-battle' ? 'teams' : 'free-for-all';
  if (result.mode === 'team-battle') result.conflictTargeting = 'all-opponents';
  if (result.mode === 'survival') result.conflictEnabled = false;
  return result;
}
export function balancedNetworkTeams(configs: readonly Pick<ParticipantConfig,'teamId'>[]): boolean {
  const first = configs.filter(p=>p.teamId === 'team-1').length;
  return first >= 2 && first <= 4 && configs.length === first*2 && configs.every(p=>p.teamId === 'team-1' || p.teamId === 'team-2');
}
export function roomRules(value: RoomRules): ResolvedRoomRules { return normalizeRoomRules(value) ?? defaultRoomRules(); }
