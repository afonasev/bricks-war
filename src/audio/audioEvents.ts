import type { MatchPhase, MatchState } from '../domain/types';

export type GameAudioEvent =
  | { type: 'countdown'; second: number }
  | { type: 'round-start' }
  | { type: 'rotate'; pan: number }
  | { type: 'lock'; pan: number }
  | { type: 'line-clear'; lines: number; pan: number }
  | { type: 'clear-impact'; lines: number; pan: number }
  | { type: 'level-up'; level: number; pan: number }
  | { type: 'anomaly-spawn'; pan: number }
  | { type: 'final-tick'; second: number }
  | { type: 'pressure' }
  | { type: 'conflict-launch'; rows: number; pan: number }
  | { type: 'conflict-impact'; rows: number; pan: number }
  | { type: 'cleanup'; rows: number; pan: number; amplified: boolean }
  | { type: 'shield-half-charge'; pan: number }
  | { type: 'shield-full-charge'; pan: number }
  | { type: 'shield-block'; pan: number }
  | { type: 'active-defense'; pan: number }
  | { type: 'final-push' }
  | { type: 'eliminated'; pan: number }
  | { type: 'results' };

interface ParticipantAudioSnapshot {
  alive: boolean;
  placedPieces: number;
  rotation: number | null;
  score: number;
  spawnSerial: number;
  levelUpEventSerial: number;
  levelUpLevel: number;
}

interface AudioSnapshot {
  countdownSecond: number;
  finalSecond: number;
  levelEventSerial: number;
  participants: Map<string, ParticipantAudioSnapshot>;
  phase: MatchPhase;
  pressureRows: number;
  pendingConflictSerial: number;
  pendingSenderCount: number;
  conflictImpactSerial: number;
  cleanupSerial: number;
  finalPushSerial: number;
  shieldInventorySerial: number;
  shieldChargeSerial: number;
  clearImpactSerial: number;
}

function participantPan(index: number, count: number): number {
  return count <= 1 ? 0 : -0.72 + ((1.44 * index) / (count - 1));
}

function takeSnapshot(state: MatchState): AudioSnapshot {
  return {
    countdownSecond: state.countdownMs > 0 ? Math.max(1, Math.ceil(state.countdownMs / 1000)) : 0,
    finalSecond: Math.ceil(state.remainingMs / 1000),
    levelEventSerial: state.levelUpEvent?.serial ?? 0,
    participants: new Map(state.participants.map((participant) => [participant.config.id, {
      alive: participant.board.alive,
      placedPieces: participant.placedPieces,
      rotation: participant.board.active?.rotation ?? null,
      score: participant.score,
      spawnSerial: participant.board.spawnSerial,
      levelUpEventSerial: participant.levelUpEvent?.serial ?? 0,
      levelUpLevel: participant.levelUpEvent?.level ?? 0,
    }])),
    phase: state.phase,
    pressureRows: state.pressureRows,
    pendingConflictSerial: state.pendingConflict?.serial ?? 0,
    pendingSenderCount: state.pendingConflict?.senders.length ?? 0,
    conflictImpactSerial: state.conflictImpactEvent?.serial ?? 0,
    cleanupSerial: state.cleanupSerial,
    finalPushSerial: state.finalPushSerial,
    shieldInventorySerial: state.shieldInventorySerial,
    shieldChargeSerial: state.shieldChargeSerial,
    clearImpactSerial: state.clearImpactSerial,
  };
}

export class AudioEventTracker {
  private previous: AudioSnapshot | null = null;

  reset(): void {
    this.previous = null;
  }

  sync(state: MatchState): GameAudioEvent[] {
    const current = takeSnapshot(state);
    const previous = this.previous;
    this.previous = current;

    if (!previous) {
      return current.phase === 'countdown' ? [{ type: 'countdown', second: current.countdownSecond }] : [];
    }

    const events: GameAudioEvent[] = [];
    if (current.phase === 'countdown' && current.countdownSecond !== previous.countdownSecond) {
      events.push({ type: 'countdown', second: current.countdownSecond });
    }
    if (previous.phase === 'countdown' && current.phase === 'playing') events.push({ type: 'round-start' });

    if (!state.isSurvival && current.levelEventSerial > previous.levelEventSerial) {
      for (let serial = previous.levelEventSerial + 1; serial <= current.levelEventSerial; serial += 1) {
        const levelsBehind = current.levelEventSerial - serial;
        events.push({ type: 'level-up', level: Math.max(1, state.gravityLevel - levelsBehind), pan: 0 });
      }
    }
    if (current.pressureRows > previous.pressureRows) events.push({ type: 'pressure' });
    if (current.finalPushSerial > previous.finalPushSerial) events.push({ type: 'final-push' });
    if (current.clearImpactSerial > previous.clearImpactSerial) {
      for (const impact of state.clearImpactEvents.filter((event) => event.serial > previous.clearImpactSerial)) {
        const index = state.participants.findIndex((participant) => participant.config.id === impact.participantId);
        events.push({ type: 'clear-impact', lines: impact.lines, pan: participantPan(Math.max(0, index), state.participants.length) });
      }
    }

    if (current.pendingConflictSerial > previous.pendingConflictSerial && state.pendingConflict) {
      const startIndex = previous.pendingConflictSerial > 0 ? previous.pendingSenderCount : 0;
      for (const sender of state.pendingConflict.senders.slice(startIndex)) {
        const participantIndex = state.participants.findIndex((participant) => participant.config.id === sender.participantId);
        events.push({
          type: 'conflict-launch',
          rows: sender.rows,
          pan: participantPan(Math.max(0, participantIndex), state.participants.length),
        });
      }
    }
    if (current.conflictImpactSerial > previous.conflictImpactSerial && state.conflictImpactEvent) {
      const recipientIndexes = Object.keys(state.conflictImpactEvent.incomingRows)
        .map((id) => state.participants.findIndex((participant) => participant.config.id === id))
        .filter((index) => index >= 0);
      const averageIndex = recipientIndexes.length > 0
        ? recipientIndexes.reduce((sum, index) => sum + index, 0) / recipientIndexes.length
        : (state.participants.length - 1) / 2;
      events.push({
        type: 'conflict-impact',
        rows: state.conflictImpactEvent.maxRows,
        pan: participantPan(averageIndex, state.participants.length),
      });
      for (const participantId of state.conflictImpactEvent.defendedRecipientIds ?? []) {
        const index = state.participants.findIndex((participant) => participant.config.id === participantId);
        events.push({ type: 'active-defense', pan: participantPan(Math.max(0, index), state.participants.length) });
      }

    }
    if (current.shieldInventorySerial > previous.shieldInventorySerial) {
      for (const event of state.shieldInventoryEvents.filter(event => event.kind === 'burn' && event.serial > previous.shieldInventorySerial)) {
        const index = state.participants.findIndex(p => p.config.id === event.participantId);
        events.push({ type: 'shield-block', pan: participantPan(Math.max(0, index), state.participants.length) });
      }
    }
    if (current.cleanupSerial > previous.cleanupSerial) {
      for (const cleanup of state.cleanupEvents.filter((event) => event.serial > previous.cleanupSerial)) {
        const participantIndex = state.participants.findIndex((participant) => participant.config.id === cleanup.participantId);
        events.push({
          type: 'cleanup',
          rows: cleanup.rows,
          pan: participantPan(Math.max(0, participantIndex), state.participants.length),
          amplified: cleanup.amplified ?? false,
        });
      }
    }
    if (current.shieldChargeSerial > previous.shieldChargeSerial) {
      for (const charge of state.shieldChargeEvents.filter((event) => event.serial > previous.shieldChargeSerial && event.kind === 'full')) {
        const index = state.participants.findIndex((participant) => participant.config.id === charge.participantId);
        events.push({
          type: charge.kind === 'half' ? 'shield-half-charge' : 'shield-full-charge',
          pan: participantPan(Math.max(0, index), state.participants.length),
        });
      }
    }

    state.participants.forEach((participant, index) => {
      const before = previous.participants.get(participant.config.id);
      if (!before) return;
      const pan = participantPan(index, state.participants.length);
      if (state.isSurvival && participant.levelUpEvent && before.levelUpEventSerial < participant.levelUpEvent.serial) {
        for (let serial = before.levelUpEventSerial + 1; serial <= participant.levelUpEvent.serial; serial += 1) {
          const levelsBehind = participant.levelUpEvent.serial - serial;
          events.push({ type: 'level-up', level: Math.max(1, participant.levelUpEvent.level - levelsBehind), pan });
        }
      }
      const active = participant.board.active;
      if (
        active
        && participant.board.spawnSerial === before.spawnSerial
        && before.rotation !== null
        && active.rotation !== before.rotation
      ) {
        events.push({ type: 'rotate', pan });
      }
      if (participant.placedPieces > before.placedPieces) {
        events.push({ type: 'lock', pan });
      }
      if (
        active?.definition.source === 'anomaly'
        && participant.board.spawnSerial > before.spawnSerial
      ) {
        events.push({ type: 'anomaly-spawn', pan });
      }
      if (before.alive && !participant.board.alive) events.push({ type: 'eliminated', pan });
    });

    if (
      current.phase === 'playing'
      && current.finalSecond > 0
      && current.finalSecond <= 10
      && current.finalSecond !== previous.finalSecond
    ) {
      events.push({ type: 'final-tick', second: current.finalSecond });
    }
    if (previous.phase !== 'results' && current.phase === 'results') events.push({ type: 'results' });
    return events;
  }
}

export function gameTempo(gravityIntervalMs: number, startingGravityMs: number, finalPush = false): number {
  const speedRatio = Math.max(1, startingGravityMs / Math.max(1, gravityIntervalMs));
  return Math.min(finalPush ? 176 : 160, Math.round(96 * (speedRatio ** 0.45)) + (finalPush ? 16 : 0));
}
