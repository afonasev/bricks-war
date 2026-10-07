import type { MatchState, ShieldPresentationState } from '../domain/types';

export function shieldPresentationForParticipant(state: MatchState, id: string): ShieldPresentationState | undefined {
  const first = state.shieldPresentations.find((event) => event.participantId === id);
  return first && first.remainingMs > 0 ? first : undefined;
}

/** Geometry is deliberately independent of absorbed/residual row counts. */
export function shieldVisualFrame(event: Pick<ShieldPresentationState, 'remainingMs' | 'durationMs'>, calm = false) {
  const p = Math.max(0, Math.min(1, 1 - event.remainingMs / event.durationMs));
  const reveal = Math.min(1, p / .24);
  const crumble = Math.max(0, Math.min(1, (p - .38) / .46));
  const returnProgress = Math.max(0, Math.min(1, (p - .7) / .3));
  return {
    liftCells: .5 * (1 - (1 - reveal) ** 3) * (1 - returnProgress),
    rowAlpha: p < .38 ? reveal : 0,
    flash: p >= .24 && p < .84 ? Math.sin((p - .24) / .6 * Math.PI) * (calm ? .55 : 1) : 0,
    crumble: calm ? Math.round(crumble * 4) / 4 : crumble,
    fragmentAlpha: p >= .38 && p < .84 ? 1 - crumble : 0,
  };
}
