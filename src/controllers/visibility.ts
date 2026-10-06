import { HumanInputRouter } from './input';
import type { MatchSession } from '../sessions/matchSession';

export function applyDocumentVisibility(
  hidden: boolean,
  engine: Pick<MatchSession, 'pause' | 'resume' | 'acceptsGameplayInput'>,
  input: HumanInputRouter,
): void {
  if (hidden) {
    engine.pause('hidden');
    input.setEnabled(false);
  } else {
    engine.resume('hidden');
    input.setEnabled(engine.acceptsGameplayInput());
  }
}
