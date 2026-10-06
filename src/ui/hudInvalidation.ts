import type { LevelUpEventState } from '../domain/types';

/**
 * The HUD needs to rerender when a level-up notice starts or ends, but not for
 * every simulation tick while the same notice is shown.
 */
export function participantLevelUpNoticeKey(event: LevelUpEventState | null): string {
  return `${event?.serial ?? 0}:${(event?.pulseMs ?? 0) > 0}`;
}
