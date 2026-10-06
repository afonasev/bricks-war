import type { ActivePiece, ParticipantState } from '../domain/types';

interface PiecePose {
  id: string;
  spawnSerial: number;
  rotation: number;
  x: number;
  y: number;
}

interface PoseTransition {
  from: PiecePose;
  to: PiecePose;
}

function poseFor(participant: ParticipantState): PiecePose | null {
  const active = participant.board.active;
  if (!active) return null;
  return {
    id: active.definition.id,
    spawnSerial: participant.board.spawnSerial,
    rotation: active.rotation,
    x: active.x,
    y: active.y,
  };
}

function isTranslation(from: PiecePose, to: PiecePose): boolean {
  return from.id === to.id
    && from.spawnSerial === to.spawnSerial
    && from.rotation === to.rotation
    && Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1;
}

export class ActivePieceInterpolation {
  private readonly transitions = new Map<string, PoseTransition>();

  snapshot(participants: readonly ParticipantState[]): Map<string, PiecePose | null> {
    return new Map(participants.map((participant) => [participant.config.id, poseFor(participant)]));
  }

  commit(before: ReadonlyMap<string, PiecePose | null>, participants: readonly ParticipantState[]): void {
    for (const participant of participants) {
      const id = participant.config.id;
      const previous = before.get(id) ?? null;
      const current = poseFor(participant);
      if (previous && current && isTranslation(previous, current)) this.transitions.set(id, { from: previous, to: current });
      else if (current) this.transitions.set(id, { from: current, to: current });
      else this.transitions.delete(id);
    }
  }

  reset(participants: readonly ParticipantState[]): void {
    this.transitions.clear();
    const snapshot = this.snapshot(participants);
    this.commit(snapshot, participants);
  }

  renderPiece(participant: ParticipantState, alpha: number, reducedMotion: boolean): ActivePiece | null {
    const active = participant.board.active;
    const transition = this.transitions.get(participant.config.id);
    if (!active || !transition || reducedMotion) return active;
    const current = poseFor(participant);
    if (!current || !isTranslation(transition.from, current)) return active;
    const progress = Math.max(0, Math.min(1, alpha));
    return {
      ...active,
      x: transition.from.x + ((transition.to.x - transition.from.x) * progress),
      y: transition.from.y + ((transition.to.y - transition.from.y) * progress),
    };
  }
}
