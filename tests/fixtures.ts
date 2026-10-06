import type { MatchState, ParticipantConfig } from '../src/domain/types';
import { MatchEngine } from '../src/simulation/match';

export const DEFAULT_SEED = 0x2a6f_19c3;

export function humanPair(): ParticipantConfig[] {
  return [
    { id: 'p1', label: 'Игрок 1', controller: 'human-1' },
    { id: 'p2', label: 'Игрок 2', controller: 'human-2' },
  ];
}

export function aiQuartet(): ParticipantConfig[] {
  return ['easy', 'medium', 'hard', 'hard'].map((difficulty, index) => ({
    id: `ai-${index + 1}`,
    label: `ИИ ${index + 1}`,
    controller: 'ai' as const,
    difficulty: difficulty as 'easy' | 'medium' | 'hard' | 'expert',
  }));
}

export function createFixture(
  participants: ParticipantConfig[] = humanPair(),
  seed = DEFAULT_SEED,
): MatchEngine {
  return new MatchEngine(participants, seed);
}

export function serializableState(state: MatchState): string {
  return JSON.stringify(state);
}
