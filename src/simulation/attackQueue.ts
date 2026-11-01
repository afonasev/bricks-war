import type { BoardAttackState } from '../domain/types';

/** The nearest unresolved warning, even while an older impact is animating. */
export function nearestAttackWarning(queue: readonly BoardAttackState[] = []): BoardAttackState | undefined {
  return queue.filter(event => event.phase === 'warning' && !event.defended)
    .reduce<BoardAttackState | undefined>((nearest, event) => !nearest || event.remainingMs < nearest.remainingMs ? event : nearest, undefined);
}
