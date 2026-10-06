import { describe, expect, it } from 'vitest';
import {
  conflictTargetIds,
  scoreLeaderIds,
  teamIdForSlot,
  teamLeaderIds,
  teamScores,
} from '../src/simulation/competition';

const participants = [
  { id: 'a', score: 100, alive: true, teamId: 'team-1' as const },
  { id: 'b', score: 40, alive: false, teamId: 'team-1' as const },
  { id: 'c', score: 90, alive: true, teamId: 'team-2' as const },
  { id: 'd', score: 20, alive: true, teamId: 'team-2' as const },
];

describe('competition policy helpers', () => {
  it('assigns the fixed two-by-two teams by setup slot', () => {
    expect([0, 1, 2, 3, 4].map(teamIdForSlot)).toEqual(['team-1', 'team-1', 'team-2', 'team-2', null]);
  });

  it('keeps score and team leaders explicit when scores tie', () => {
    expect(scoreLeaderIds([{ id: 'a', score: 100, alive: true }, { id: 'b', score: 100, alive: true }])).toEqual(['a', 'b']);
    expect(scoreLeaderIds([{ id: 'a', score: 100, alive: false }, { id: 'b', score: 90, alive: true }])).toEqual(['b']);
    expect(teamLeaderIds([
      { id: 'a', score: 100, alive: true, teamId: 'team-1' },
      { id: 'b', score: 100, alive: true, teamId: 'team-2' },
    ])).toEqual(['team-1', 'team-2']);
  });

  it('calculates full survivor and half eliminated teammate contributions', () => {
    expect(teamScores(participants)).toEqual([
      { teamId: 'team-1', memberIds: ['a', 'b'], score: 120, alive: true, highestSurvivingScore: 100 },
      { teamId: 'team-2', memberIds: ['c', 'd'], score: 110, alive: true, highestSurvivingScore: 90 },
    ]);
  });

  it('targets only a unique non-self leader and never targets a teammate', () => {
    expect(conflictTargetIds('c', participants, 'free-for-all', 'hunt-leader')).toEqual(['a']);
    expect(conflictTargetIds('a', participants, 'free-for-all', 'hunt-leader')).toEqual([]);
    expect(conflictTargetIds('a', participants, 'teams', 'all-opponents')).toEqual(['c', 'd']);
    expect(conflictTargetIds('a', [
      { id: 'a', score: 10, alive: true }, { id: 'b', score: 10, alive: true }, { id: 'c', score: 5, alive: true },
    ], 'free-for-all', 'hunt-leader')).toEqual([]);
  });
});
