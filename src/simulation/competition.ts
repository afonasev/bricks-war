import type { ConflictTargeting, MatchVariant, TeamId } from '../domain/types';

export interface CompetitionParticipant {
  id: string;
  score: number;
  alive: boolean;
  teamId?: TeamId;
}

export interface TeamScore {
  teamId: TeamId;
  memberIds: string[];
  score: number;
  alive: boolean;
  highestSurvivingScore: number;
}

const TEAM_IDS: readonly TeamId[] = ['team-1', 'team-2'];

export function teamIdForSlot(slotIndex: number): TeamId | null {
  if (slotIndex === 0 || slotIndex === 1) return 'team-1';
  if (slotIndex === 2 || slotIndex === 3) return 'team-2';
  return null;
}

export function participantTeamId(config: {teamId?: TeamId}, slotIndex: number): TeamId | null {
  return config.teamId ?? teamIdForSlot(slotIndex);
}

export function scoreLeaderIds(participants: readonly CompetitionParticipant[]): string[] {
  const active = participants.filter((participant) => participant.alive);
  const highestScore = Math.max(...active.map((participant) => participant.score));
  return active
    .filter((participant) => participant.score === highestScore)
    .map((participant) => participant.id)
    .sort();
}

export function teamScores(participants: readonly CompetitionParticipant[]): TeamScore[] {
  return TEAM_IDS.map((teamId) => {
    const members = participants.filter((participant) => participant.teamId === teamId);
    const survivors = members.filter((participant) => participant.alive);
    return {
      teamId,
      memberIds: members.map((participant) => participant.id).sort(),
      score: members.reduce((total, participant) => total + (participant.alive ? participant.score : participant.score / 2), 0),
      alive: survivors.length > 0,
      highestSurvivingScore: Math.max(0, ...survivors.map((participant) => participant.score)),
    };
  });
}

export function teamLeaderIds(participants: readonly CompetitionParticipant[]): TeamId[] {
  const activeTeams = teamScores(participants).filter((team) => team.alive);
  const highestScore = Math.max(...activeTeams.map((team) => team.score));
  return activeTeams.filter((team) => team.score === highestScore).map((team) => team.teamId);
}

export function conflictTargetIds(
  attackerId: string,
  participants: readonly CompetitionParticipant[],
  variant: MatchVariant,
  targeting: ConflictTargeting,
): string[] {
  const attacker = participants.find((participant) => participant.id === attackerId);
  if (!attacker?.alive) return [];
  const activeOpponents = participants.filter((participant) => (
    participant.alive
    && participant.id !== attackerId
    && (variant !== 'teams' || participant.teamId !== attacker.teamId)
  ));
  if (variant === 'teams' || targeting === 'all-opponents') {
    return activeOpponents.map((participant) => participant.id).sort();
  }
  const leaders = scoreLeaderIds(participants);
  return leaders.length === 1 && leaders[0] !== attackerId ? leaders : [];
}
