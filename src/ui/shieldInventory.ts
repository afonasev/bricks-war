import type { MatchState, ParticipantState } from '../domain/types';

/** Explicit slot events retain shield use even when a gain and burn have the same net count. */
export function shieldInventoryMarkup(participant: ParticipantState, match: MatchState): string {
  const events = match.shieldInventoryEvents.filter((event) =>
    event.participantId === participant.config.id && event.pulseMs > 0);
  const slots = Array.from({ length: 3 }, (_, index) => {
    const affects = events.filter((event) => index >= event.firstSlot && index < event.firstSlot + event.count);
    const burning = affects.some((event) => event.kind === 'burn');
    const gained = affects.some((event) => event.kind === 'gain');
    const state = burning ? 'is-burning is-burn' : index < participant.shieldCount ? 'is-full' : 'is-empty';
    return `<span class="shield-slot ${state}${gained ? ' is-gain' : ''}" aria-hidden="true"><svg viewBox="0 0 32 36" focusable="false"><path d="M16 2 29 7v10c0 8-5 13-13 17C8 30 3 25 3 17V7z"/></svg><i></i></span>`;
  }).join('');
  return `<div class="shield-inventory" aria-label="Щиты: ${participant.shieldCount}/3">${slots}</div>`;
}

export function shieldInventoryKey(match: MatchState): string {
  return match.shieldInventoryEvents.map((event) => `${event.serial}:${event.participantId}:${event.kind}:${event.firstSlot}:${event.count}`).join('|');
}
