import type { MatchState } from '../domain/types';

export const EFFECT_FRAME_MS = 50;

function effectFrame(milliseconds: number | undefined): number {
  return Math.ceil((milliseconds ?? 0) / EFFECT_FRAME_MS);
}

/** Uses board mutation revisions and never walks grid cells. */
export function staticPlayfieldRenderKey(state: MatchState, layoutKey: string, width: number, height: number): string {
  return [
    `${width}x${height}:${layoutKey}`,
    state.options.matchVariant,
    state.participants.map((participant) => [
      participant.resolvedTileStyle,
      participant.board.alive ? 1 : 0,
      participant.board.staticRenderRevision,
      state.clearPresentations.some((event) => event.participantId === participant.config.id) ? 1 : 0,
    ].join(':')).join('|'),
  ].join('#');
}

/** Dynamic state is deliberately small: active poses and bounded presentation effects. */
export function playfieldRenderKey(
  state: MatchState,
  layoutKey: string,
  width: number,
  height: number,
  nowMs: number,
  reducedMotion: boolean,
): string {
  const pendingRows = state.pendingConflict?.senders.map((sender) => `${sender.participantId}:${sender.rows}`).join(',') ?? '';
  const impactRows = state.conflictImpactEvent?.maxRows ?? 0;
  const rareAttack = Math.max(0, impactRows, ...(state.pendingConflict?.senders.map((sender) => sender.rows) ?? []));
  const motionActive = !reducedMotion && (
    rareAttack >= 4
    || pendingRows.length > 0
    || state.participants.some((participant) => participant.board.active?.definition.source === 'anomaly')
  );
  return [
    staticPlayfieldRenderKey(state, layoutKey, width, height),
    state.phase,
    `${state.globalEventHold?.kind ?? ''}:${effectFrame(state.globalEventHold?.remainingMs)}`,
    effectFrame(state.roundStartPulseMs),
    effectFrame(state.pressurePulseMs),
    `${state.levelUpEvent?.serial ?? 0}:${effectFrame(state.levelUpEvent?.pulseMs)}:${state.participants.map((participant) => `${participant.levelUpEvent?.serial ?? 0}:${effectFrame(participant.levelUpEvent?.pulseMs)}`).join(',')}`,
    `${state.pendingConflict?.serial ?? 0}:${effectFrame(state.pendingConflict?.remainingWarningMs)}:${pendingRows}:${state.participants.map(p => p.shieldCount).join()}`,
    `${state.conflictImpactEvent?.serial ?? 0}:${effectFrame(state.conflictImpactEvent?.pulseMs)}:${impactRows}`,
    `${state.cleanupSerial}:${state.cleanupEvents.map((event) => `${event.participantId}:${event.rows}:${effectFrame(event.pulseMs)}`).join(',')}`,
    `${state.anomalyBurnSerial}:${state.anomalyBurnEvents.map((event) => `${event.participantId}:${event.rows.length}:${effectFrame(event.pulseMs)}`).join(',')}`,
    `${state.clearPresentationSerial}:${state.clearPresentations.map((event) => `${event.participantId}:${event.phase}:${effectFrame(event.remainingMs)}`).join(',')}`,
    state.participants.map((participant) => {
      const active = participant.board.active;
      return active ? `${participant.board.spawnSerial}:${active.definition.id}:${active.rotation}:${active.x}:${active.y}` : '-';
    }).join('|'),
    motionActive ? Math.floor(nowMs / EFFECT_FRAME_MS) : 0,
  ].join('#');
}
