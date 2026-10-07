import type {MatchState} from '../domain/types';
import {MatchEngine, FIXED_STEP_MS} from '../simulation/match';
import type {PieceSequence} from '../simulation/random';
import {MAX_PREDICTION_TICKS, type ClientSnapshot, type InputEnvelope} from './protocol';
import {pieceActions} from './scheduledInput';

/** Rebuild to the same presentation tick, not to an older received picture. */
export class OwnPrediction {
  engine: MatchEngine | null = null;
  tick = 0;
  private sequence?: PieceSequence;
  private baseTick = 0;
  private ownId = '';
  private renderedGrid: unknown;
  private renderedSimulationRevision = -1;
  private gridKey = '';
  private presentationRevision = 1;
  private refreshGrid(): void {
    const board=this.engine?.state.participants.find(p=>p.config.id===this.ownId)?.board;
    if (!board || (board.grid===this.renderedGrid && board.staticRenderRevision===this.renderedSimulationRevision)) return;
    const key=JSON.stringify(board.grid);
    if(key!==this.gridKey){this.gridKey=key;this.presentationRevision++;}
    this.renderedGrid=board.grid;this.renderedSimulationRevision=board.staticRenderRevision;
  }
  reset(): void {this.engine = null; this.sequence = undefined; this.tick = 0;}
  confirm(snapshot: ClientSnapshot, inputs: readonly InputEnvelope[], targetTick: number): void {
    if (!snapshot.state || !snapshot.prediction) {this.reset(); return;}
    this.engine = MatchEngine.restorePrediction(snapshot.state, snapshot.prediction, this.sequence);
    this.sequence = this.engine.sequence;
    this.ownId = snapshot.ownId;
    this.tick = this.baseTick = snapshot.tick;
    this.advanceTo(Math.max(snapshot.tick, targetTick), inputs);
    this.refreshGrid();
  }
  advanceTo(targetTick: number, inputs: readonly InputEnvelope[]): void {
    const engine = this.engine;
    if (!engine) return;
    const end = Math.min(Math.floor(targetTick), this.baseTick + MAX_PREDICTION_TICKS);
    while (this.tick < end) {
      const next = this.tick + 1;
      const spawn = engine.state.participants.find(p => p.config.id === this.ownId)!.board.spawnSerial;
      // A late command is replayed at the first available tick until its disposition arrives.
      const actions = inputs.filter(input => Math.max(this.baseTick + 1, input.targetTick) === next)
        .flatMap(input => pieceActions(input, spawn));
      engine.stepOwnPrediction(this.ownId, FIXED_STEP_MS, actions);
      this.tick = next;
    }
    this.refreshGrid();
  }
  present(confirmed: MatchState): MatchState {
    const predicted = this.engine?.state;
    const own = predicted?.participants.find(p => p.config.id === this.ownId);
    if (!predicted || !own || confirmed.phase !== 'playing' || confirmed.anomalyTransition || confirmed.globalEventHold) return confirmed;
    return {...confirmed,
      participants: confirmed.participants.map(p => p.config.id === this.ownId
        // Render-only negative revisions cannot collide with authoritative mutation counters.
        // Reconciliation may change geometry without changing the number of locks.
        ? {...p, board: {...own.board, staticRenderRevision: -this.presentationRevision}, gravityIntervalMs: own.gravityIntervalMs} : p),
      // Geometry follows the predicted grid; global serial/effect/audio streams stay confirmed.
      clearPresentations: [...confirmed.clearPresentations.filter(e => e.participantId !== this.ownId),
        ...predicted.clearPresentations.filter(e => e.participantId === this.ownId)],
      anomalyBurnEvents: [...confirmed.anomalyBurnEvents.filter(e => e.participantId !== this.ownId),
        ...predicted.anomalyBurnEvents.filter(e => e.participantId === this.ownId)]};
  }
}
