import type { MatchMessageTemplates } from '../domain/gameTuning';
import type { MatchState } from '../domain/types';
import {
  ANOMALY_BURN_PULSE_MS,
  CLEANUP_PULSE_MS,
  CONFLICT_IMPACT_PULSE_MS,
  FINAL_PUSH_PULSE_MS,
  LEVEL_UP_PULSE_MS,
  ROUND_START_PULSE_MS,
  SHIELD_CHARGE_NOTICE_MS,
} from '../simulation/match';
import { formatMatchMessage } from './matchMessages';

export type MatchEventKind =
  | 'round-start'
  | 'level-up'
  | 'final-push'
  | 'incoming-attack'
  | 'active-defense'
  | 'shield-block'
  | 'shield-half'
  | 'shield-full'
  | 'anomaly-burn'
  | 'cleanup';

export type MatchEventIcon = 'start' | 'level' | 'pressure' | 'attack' | 'defense' | 'shield-half' | 'shield' | 'anomaly' | 'cleanup';
export type MatchEventAccent = 'blue' | 'violet' | 'red' | 'cyan' | 'amber' | 'mint';
export type MatchEventHoldPolicy = 'none' | 'global' | 'participant';

export interface MatchEventDescriptor {
  kind: MatchEventKind;
  scope: 'global' | string;
  priority: number;
  icon: MatchEventIcon;
  accent: MatchEventAccent;
  title: string;
  detail?: string;
  lifetimeMs: number;
  hold: MatchEventHoldPolicy;
  template?: string;
  values?: Partial<Record<'senders' | 'rows', string | number>>;
}

type EventDefinition = Pick<MatchEventDescriptor, 'priority' | 'icon' | 'accent' | 'lifetimeMs' | 'hold'>;

export const MATCH_EVENT_DEFINITIONS: Readonly<Record<MatchEventKind, EventDefinition>> = {
  'round-start': { priority: 10, icon: 'start', accent: 'blue', lifetimeMs: ROUND_START_PULSE_MS, hold: 'none' },
  'level-up': { priority: 80, icon: 'level', accent: 'violet', lifetimeMs: LEVEL_UP_PULSE_MS, hold: 'global' },
  'final-push': { priority: 100, icon: 'pressure', accent: 'violet', lifetimeMs: FINAL_PUSH_PULSE_MS, hold: 'global' },
  'incoming-attack': { priority: 70, icon: 'attack', accent: 'red', lifetimeMs: CONFLICT_IMPACT_PULSE_MS, hold: 'none' },
  'active-defense': { priority: 90, icon: 'defense', accent: 'cyan', lifetimeMs: CONFLICT_IMPACT_PULSE_MS, hold: 'none' },
  'shield-block': { priority: 90, icon: 'shield', accent: 'cyan', lifetimeMs: CONFLICT_IMPACT_PULSE_MS, hold: 'none' },
  'shield-half': { priority: 50, icon: 'shield-half', accent: 'cyan', lifetimeMs: SHIELD_CHARGE_NOTICE_MS, hold: 'none' },
  'shield-full': { priority: 60, icon: 'shield', accent: 'cyan', lifetimeMs: SHIELD_CHARGE_NOTICE_MS, hold: 'none' },
  'anomaly-burn': { priority: 95, icon: 'anomaly', accent: 'amber', lifetimeMs: ANOMALY_BURN_PULSE_MS, hold: 'participant' },
  cleanup: { priority: 40, icon: 'cleanup', accent: 'mint', lifetimeMs: CLEANUP_PULSE_MS, hold: 'none' },
};

function descriptor(kind: MatchEventKind, scope: 'global' | string, title: string, detail?: string): MatchEventDescriptor {
  return { kind, scope, title, detail, ...MATCH_EVENT_DEFINITIONS[kind] };
}

export function globalMatchEvent(
  state: MatchState,
  messages: MatchMessageTemplates,
): MatchEventDescriptor | null {
  const hold = state.globalEventHold;
  const acceleratingPressure = state.isSurvival || state.options.battleTimeMode === 'until-victory';
  if (hold?.kind === 'final-push' || state.finalPushPulseMs > 0) {
    const baseDetail = acceleratingPressure
      ? 'Серый ряд каждые 15 → 5 секунд'
      : messages.finalPushHint;
    const detail = baseDetail;
    return descriptor(
      'final-push',
      'global',
      acceleratingPressure ? 'Фаза давления' : messages.finalPushTitle,
      detail,
    );
  }
  if (state.roundStartPulseMs > 0) return descriptor('round-start', 'global', messages.roundStart);
  return null;
}

export function participantMatchEvent(
  state: MatchState,
  participantId: string,
  _messages: MatchMessageTemplates,
  senderNames: readonly string[],
): MatchEventDescriptor | null {
  const incomingRows = state.pendingConflict?.incomingRows[participantId] ?? 0;
  if (incomingRows > 0) {
    const current = state.attackQueues[participantId]?.[0];
    const values = { senders: current?.reason === 'pressure' ? '' : current?.senderLabel ?? senderNames.join(', '), rows: incomingRows };
    return {
      ...descriptor('incoming-attack',participantId, `${values.senders}${values.senders ? ' ' : ''}⚔ ${incomingRows}`),
      lifetimeMs: current?.remainingMs ?? state.pendingConflict?.remainingWarningMs ?? 3000,
    };
  }

  const cleanup = state.cleanupEvents.find((event) => event.participantId === participantId);
  if (cleanup && !cleanup.amplified) return {
    ...descriptor('cleanup', participantId, `Очищено · ${cleanup.rows}`, 'Серые ряды удалены'),
    lifetimeMs: cleanup.pulseMs,
  };
  return null;
}

const ICON_PATHS: Readonly<Record<MatchEventIcon, string>> = {
  start: '<path d="M5 5v14M6 6h9l-2 3 2 3H6"/>',
  level: '<path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z"/><path d="M19 16v5M16.5 18.5h5"/>',
  pressure: '<path d="M3 6l4 4-4 4M21 6l-4 4 4 4M9 6h6M9 10h6M9 14h6"/>',
  attack: '<path d="M5 19l4-4M6 12l6 6M9 15L19 5l-4 1-7 7"/>',
  defense: '<path d="M4 6l5 5-5 5M20 6l-5 5 5 5M8 20L16 4"/>',
  'shield-half': '<path d="M12 2l8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5z"/><path d="M5 13h14"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5z"/><path d="M8 11l3 3 5-6"/>',
  anomaly: '<path d="M12 2l8 8-8 12-8-12zM12 2l-2 7 4 3-3 10"/>',
  cleanup: '<path d="M5 18h14M6 14h12M8 10h8M12 8V3M9 6l3-3 3 3"/>',
};

export function matchEventIconMarkup(icon: MatchEventIcon): string {
  return `<svg class="match-event-icon" data-icon="${icon}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[icon]}</svg>`;
}

export function escapeMatchEventHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character] ?? character));
}

export function formatParticipantEventMarkup(
  template: string,
  values: Parameters<typeof formatMatchMessage>[1],
): string {
  return template.split(/(\{senders\})/).map((part) => (
    part === '{senders}'
      ? `<span class="player-event-sender">${escapeMatchEventHtml(String(values.senders ?? ''))}</span>`
      : escapeMatchEventHtml(formatMatchMessage(part, values))
  )).join('');
}

export function matchEventPlaqueMarkup(
  event: MatchEventDescriptor,
  titleMarkup = escapeMatchEventHtml(event.title),
): string {
  if(event.kind==='incoming-attack') titleMarkup=titleMarkup.replace('⚔',matchEventIconMarkup('attack'));
  return `<span class="match-event-icon-tile" aria-hidden="true">${matchEventIconMarkup(event.icon)}</span><span class="match-event-copy"><strong>${titleMarkup}</strong>${event.detail ? `<small>${escapeMatchEventHtml(event.detail)}</small>` : ''}</span>`;
}
