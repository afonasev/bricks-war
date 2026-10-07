import type {GameAction} from '../domain/types';
import {HORIZONTAL_REPEAT_DELAY_MS, HORIZONTAL_REPEAT_INTERVAL_MS} from '../controllers/input';
import {FIXED_STEP_MS} from '../simulation/match';
import {EMPTY_HELD, MAX_INPUT_LEAD_TICKS, MAX_INPUT_LATENESS_TICKS, type InputEnvelope} from './protocol';

/** Validate the scheduled cadence, never derive extra actions from packet arrival time. */
export class ScheduledInput {
  private held = {...EMPTY_HELD};
  private onset = 0;
  private moves = 0;
  private lastTick = -1;
  private lastMoveTick = -1;
  accept(input: InputEnvelope, serverTick: number): boolean {
    if (!Array.isArray(input.actions)) return false;
    // A delayed release grants no movement or repeat credit and must be able to
    // end recovery even when transport delay exceeds the movement lateness bound.
    const release = !input.rotate && !input.held.left && !input.held.right && !input.held.down
      && input.actions.every(action => action === 'soft-drop-off');
    if (!Number.isSafeInteger(input.targetTick) || input.targetTick < 0
      || (!release && input.targetTick < Math.max(0, serverTick - MAX_INPUT_LATENESS_TICKS))
      || input.targetTick < this.lastTick || input.targetTick > serverTick + MAX_INPUT_LEAD_TICKS
      || !Number.isSafeInteger(input.spawnSerial) || input.spawnSerial < 0
      || !Array.isArray(input.actions) || input.actions.length > 4) return false;
    const direction = Number(input.held.right) - Number(input.held.left);
    const previous = Number(this.held.right) - Number(this.held.left);
    const onset = direction !== previous ? input.targetTick : this.onset;
    let moves = direction !== previous ? 0 : this.moves;
    let rotations = 0, dropOn = 0, dropOff = 0, batchMoves = 0;
    for (const action of input.actions) {
      if (action === 'move-left' || action === 'move-right') {
        if (!direction || action !== (direction < 0 ? 'move-left' : 'move-right')) return false;
        moves++; batchMoves++;
      } else if (action === 'rotate-clockwise') rotations++;
      else if (action === 'soft-drop-on') dropOn++;
      else if (action === 'soft-drop-off') dropOff++;
      else return false;
    }
    // One fixed-step quantization allowance; no allowance based on network jitter.
    const elapsed = (input.targetTick - onset + 1) * FIXED_STEP_MS;
    const allowed = 1 + Math.max(0, 1 + Math.floor((elapsed - HORIZONTAL_REPEAT_DELAY_MS) / HORIZONTAL_REPEAT_INTERVAL_MS));
    if (batchMoves > 1 || (batchMoves > 0 && direction === previous && this.moves > 0
      && input.targetTick - this.lastMoveTick < Math.ceil(HORIZONTAL_REPEAT_INTERVAL_MS / FIXED_STEP_MS) - 1)
      || moves > allowed || rotations !== Number(input.rotate) || rotations > 1
      || dropOn > 1 || dropOff > 1 || (dropOn > 0 && !input.held.down)
      || (dropOff > 0 && input.held.down)
      || (input.held.down !== this.held.down && (input.held.down ? dropOn : dropOff) !== 1)) return false;
    if (batchMoves) this.lastMoveTick = input.targetTick;
    this.held = {...input.held}; this.onset = onset; this.moves = moves; this.lastTick = input.targetTick;
    return true;
  }
}

/** Drop state belongs to the controller; rotate/movement belong to one piece. */
export function pieceActions(input: InputEnvelope, spawnSerial: number): GameAction[] {
  return input.actions.filter(action => input.spawnSerial === spawnSerial || action === 'soft-drop-on' || action === 'soft-drop-off');
}
