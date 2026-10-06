import type { GameAction } from '../domain/types';
import { HORIZONTAL_REPEAT_DELAY_MS, HORIZONTAL_REPEAT_INTERVAL_MS } from '../controllers/input';
import { EMPTY_HELD, type HeldControls } from './protocol';
/** Identical movement repeat timing on service and presentation. No client clock is trusted. */
export class HeldInput {
  held: HeldControls = { ...EMPTY_HELD };
  holdSequence = 0;
  completedRepeats = 0;
  private horizontal = 0;
  private elapsed = 0;
  private nextRepeat = HORIZONTAL_REPEAT_DELAY_MS;
  private pending: GameAction[] = [];
  update(held: HeldControls, rotate: boolean, sequence = 0): void {
    const direction = Number(held.right) - Number(held.left);
    if (direction !== this.horizontal) {
      this.horizontal = direction; this.elapsed = 0; this.nextRepeat = HORIZONTAL_REPEAT_DELAY_MS;
      this.holdSequence = sequence; this.completedRepeats = 0;
      if (direction) this.pending.push(direction < 0 ? 'move-left' : 'move-right');
    }
    if (held.down !== this.held.down) this.pending.push(held.down ? 'soft-drop-on' : 'soft-drop-off');
    if (rotate) this.pending.push('rotate-clockwise');
    this.held = { ...held };
  }
  step(deltaMs: number): GameAction[] {
    const actions = this.pending.splice(0);
    if (this.horizontal) {
      this.elapsed += deltaMs;
      while (this.elapsed >= this.nextRepeat) {
        actions.push(this.horizontal < 0 ? 'move-left' : 'move-right');
        this.completedRepeats++;
        this.nextRepeat += HORIZONTAL_REPEAT_INTERVAL_MS;
      }
    }
    return actions;
  }
  reset(): void {
    this.held = { ...EMPTY_HELD }; this.horizontal = 0; this.elapsed = 0;
    this.nextRepeat = HORIZONTAL_REPEAT_DELAY_MS; this.pending = [];
    this.holdSequence = 0; this.completedRepeats = 0;
  }
  acknowledge(sequence:number,ordinal:number):void {
    if(sequence!==this.holdSequence||ordinal<=this.completedRepeats)return;
    this.completedRepeats=ordinal;
    this.nextRepeat=HORIZONTAL_REPEAT_DELAY_MS+ordinal*HORIZONTAL_REPEAT_INTERVAL_MS;
    this.elapsed=Math.max(this.elapsed,this.nextRepeat-HORIZONTAL_REPEAT_INTERVAL_MS);
  }
}
