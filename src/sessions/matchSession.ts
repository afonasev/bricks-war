import type { ActionsByParticipant, MatchState, PauseReason } from '../domain/types';
import type { MatchEngine } from '../simulation/match';
export interface MatchSession {
  readonly kind: 'local' | 'network';
  readonly state: MatchState;
  step(deltaMs: number, actions?: ActionsByParticipant): void;
  acceptsGameplayInput(): boolean;
  toggleManualPause(): boolean;
  pause(reason?: PauseReason): void;
  resume(reason?: PauseReason): void;
}
export class LocalMatchSession implements MatchSession {
  readonly kind = 'local';
  constructor(readonly engine: MatchEngine) {}
  get state(): MatchState { return this.engine.state; }
  step(deltaMs: number, actions?: ActionsByParticipant): void {this.engine.step(deltaMs, actions);}
  acceptsGameplayInput(): boolean {return this.engine.acceptsGameplayInput();}
  toggleManualPause(): boolean {return this.engine.toggleManualPause();}
  pause(reason?: PauseReason): void {this.engine.pause(reason);}
  resume(reason?: PauseReason): void {this.engine.resume(reason);}
}
