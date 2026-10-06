import type { MatchState } from '../domain/types';
import { CLEANUP_PULSE_MS, CONFLICT_IMPACT_PULSE_MS, CONFLICT_WARNING_MS } from '../simulation/match';

export type ConflictTier = 0 | 1 | 3 | 4;

export interface ConflictPresentation {
  senderRows: number;
  incomingRows: number;
  impactRows: number;
  cleanupRows: number;
  tier: ConflictTier;
  warningProgress: number;
  impactProgress: number;
  cleanupProgress: number;
  shieldReady: boolean;
  activelyDefended: boolean;
  shieldBlocked: boolean;
  senderIds: string[];
}

export function conflictTier(rows: number): ConflictTier {
  if (rows >= 4) return 4;
  if (rows >= 3) return 3;
  if (rows >= 1) return 1;
  return 0;
}

export function conflictPresentationForParticipant(
  state: MatchState,
  participantId: string,
): ConflictPresentation {
  const pending = state.pendingConflict;
  const senderRows = Math.max(
    0,
    ...(pending?.senders
      .filter((sender) => sender.participantId === participantId)
      .map((sender) => sender.rows) ?? []),
  );
  const incomingRows = pending?.incomingRows[participantId] ?? 0;
  const senderIds = (pending?.senders ?? [])
    .filter((sender) => sender.recipientIds.includes(participantId))
    .map((sender) => sender.participantId)
    .sort();
  const participant = state.participants.find((candidate) => candidate.config.id === participantId);
  const impactRows = state.conflictImpactEvent?.incomingRows[participantId] ?? 0;
  const cleanupEvent = state.cleanupEvents
    .filter((event) => event.participantId === participantId)
    .sort((left, right) => right.serial - left.serial)[0];
  const cleanupRows = cleanupEvent?.rows ?? 0;
  return {
    senderRows,
    incomingRows,
    impactRows,
    cleanupRows,
    tier: conflictTier(Math.max(senderRows, incomingRows, impactRows)),
    warningProgress: pending ? 1 - (pending.remainingWarningMs / CONFLICT_WARNING_MS) : 0,
    impactProgress: state.conflictImpactEvent ? state.conflictImpactEvent.pulseMs / CONFLICT_IMPACT_PULSE_MS : 0,
    cleanupProgress: cleanupEvent ? cleanupEvent.pulseMs / CLEANUP_PULSE_MS : 0,
    shieldReady: incomingRows > 0 && (participant?.shieldCount ?? 0) >= incomingRows,
    activelyDefended: state.conflictImpactEvent?.defendedRecipientIds?.includes(participantId) ?? false,
    shieldBlocked: impactRows === 0 && (state.conflictImpactEvent?.pulseMs ?? 0) > 0
      && (state.conflictImpactEvent?.shieldedRecipientIds?.includes(participantId) ?? false),
    senderIds,
  };
}
