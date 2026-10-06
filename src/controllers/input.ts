import type { ActionsByParticipant, GameAction, ManualController, ParticipantConfig } from '../domain/types';
import type { GamepadControls } from './gamepads';

interface Binding {
  participant: ManualController;
  down: GameAction;
  up?: GameAction;
}

const KEY_BINDINGS: Readonly<Record<string, Binding>> = {
  KeyA: { participant: 'human-1', down: 'move-left' },
  KeyD: { participant: 'human-1', down: 'move-right' },
  KeyW: { participant: 'human-1', down: 'rotate-clockwise' },
  KeyS: { participant: 'human-1', down: 'soft-drop-on', up: 'soft-drop-off' },
  ArrowLeft: { participant: 'human-2', down: 'move-left' },
  ArrowRight: { participant: 'human-2', down: 'move-right' },
  ArrowUp: { participant: 'human-2', down: 'rotate-clockwise' },
  ArrowDown: { participant: 'human-2', down: 'soft-drop-on', up: 'soft-drop-off' },
};

export const HORIZONTAL_REPEAT_DELAY_MS = 140;
export const HORIZONTAL_REPEAT_INTERVAL_MS = 45;

interface HeldMovement {
  binding: Binding;
  elapsedMs: number;
  nextRepeatMs: number;
}

export class HumanInputRouter {
  private readonly participantIds = new Map<ManualController, string>();
  private readonly queued = new Map<string, GameAction[]>();
  private readonly held = new Set<string>();
  private readonly heldMovements = new Map<string, HeldMovement>();
  private readonly releasesAfterPause = new Map<string, Binding>();
  private readonly blockedUntilRelease = new Set<string>();
  private enabled = false;

  constructor(
    private readonly repeatDelayMs = HORIZONTAL_REPEAT_DELAY_MS,
    private readonly repeatIntervalMs = HORIZONTAL_REPEAT_INTERVAL_MS,
  ) {}

  configure(configs: readonly ParticipantConfig[]): void {
    this.participantIds.clear();
    for (const config of configs) if (config.controller !== 'ai') this.participantIds.set(config.controller, config.id);
    this.clear();
  }

  setEnabled(enabled: boolean, discardHeld = false): void {
    if (discardHeld) {
      for (const source of this.held) this.blockedUntilRelease.add(source);
      this.queued.clear();
      this.held.clear();
      this.heldMovements.clear();
      this.releasesAfterPause.clear();
    }
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.queued.clear();
      return;
    }
    for (const binding of this.releasesAfterPause.values()) {
      if (binding.up) this.enqueue(binding.participant, binding.up);
    }
    this.releasesAfterPause.clear();
  }

  handleKeyDown(code: string, repeat = false): boolean {
    const binding = KEY_BINDINGS[code];
    if (!binding || !this.participantIds.has(binding.participant)) return false;
    if (!this.enabled) {
      this.blockedUntilRelease.add(code);
      return true;
    }
    if (this.blockedUntilRelease.has(code)) return true;
    if (repeat || this.held.has(code)) return true;
    this.held.add(code);
    this.enqueue(binding.participant, binding.down);
    if (binding.down === 'move-left' || binding.down === 'move-right') {
      this.heldMovements.set(code, {
        binding,
        elapsedMs: 0,
        nextRepeatMs: this.repeatDelayMs,
      });
    }
    return true;
  }

  handleKeyUp(code: string): boolean {
    const binding = KEY_BINDINGS[code];
    if (!binding || !this.participantIds.has(binding.participant)) return false;
    if (this.blockedUntilRelease.delete(code)) return true;
    const wasHeld = this.held.delete(code);
    this.heldMovements.delete(code);
    if (wasHeld && binding.up) {
      if (this.enabled) this.enqueue(binding.participant, binding.up);
      else this.releasesAfterPause.set(code, binding);
    }
    return true;
  }

  updateGamepad(controller: ManualController, controls: GamepadControls | null): void {
    if (!this.participantIds.has(controller)) return;
    const states: ReadonlyArray<[string, GameAction, boolean, GameAction?]> = [
      ['left', 'move-left', controls?.left ?? false],
      ['right', 'move-right', controls?.right ?? false],
      ['down', 'soft-drop-on', controls?.down ?? false, 'soft-drop-off'],
      ['rotate', 'rotate-clockwise', controls?.rotate ?? false],
    ];
    for (const [control, action, pressed, release] of states) {
      const source = `${controller}:${control}`;
      if (pressed) this.press(source, { participant: controller, down: action, up: release });
      else this.release(source, { participant: controller, down: action, up: release });
    }
  }

  /** Shared path for touch buttons and motion controls. */
  updateVirtual(controller: ManualController, controls: GamepadControls | null): void {
    this.updateGamepad(controller, controls);
  }

  drain(): ActionsByParticipant {
    const actions = new Map<string, readonly GameAction[]>();
    for (const [participantId, queued] of this.queued) actions.set(participantId, [...queued]);
    this.queued.clear();
    return actions;
  }

  step(deltaMs: number): void {
    if (!this.enabled || deltaMs <= 0) return;
    for (const movement of this.heldMovements.values()) {
      movement.elapsedMs += deltaMs;
      while (movement.elapsedMs >= movement.nextRepeatMs) {
        this.enqueue(movement.binding.participant, movement.binding.down);
        movement.nextRepeatMs += this.repeatIntervalMs;
      }
    }
  }

  clear(): void {
    this.queued.clear();
    this.held.clear();
    this.heldMovements.clear();
    this.releasesAfterPause.clear();
    this.blockedUntilRelease.clear();
  }

  private press(source: string, binding: Binding): void {
    if (!this.enabled) {
      this.blockedUntilRelease.add(source);
      return;
    }
    if (this.blockedUntilRelease.has(source) || this.held.has(source)) return;
    this.held.add(source);
    this.enqueue(binding.participant, binding.down);
    if (binding.down === 'move-left' || binding.down === 'move-right') {
      this.heldMovements.set(source, { binding, elapsedMs: 0, nextRepeatMs: this.repeatDelayMs });
    }
  }

  private release(source: string, binding: Binding): void {
    if (this.blockedUntilRelease.delete(source)) return;
    const wasHeld = this.held.delete(source);
    this.heldMovements.delete(source);
    if (!wasHeld || !binding.up) return;
    if (this.enabled) this.enqueue(binding.participant, binding.up);
    else this.releasesAfterPause.set(source, binding);
  }

  private enqueue(controller: ManualController, action: GameAction): void {
    const participantId = this.participantIds.get(controller);
    if (!participantId) return;
    const queue = this.queued.get(participantId) ?? [];
    queue.push(action);
    this.queued.set(participantId, queue);
  }
}

export function isCapturedGameKey(code: string): boolean {
  return code in KEY_BINDINGS;
}

export function isManualPauseKey(event: Pick<KeyboardEvent, 'code' | 'repeat'>): boolean {
  return event.code === 'Escape' && !event.repeat;
}
