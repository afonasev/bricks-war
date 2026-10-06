/** Suppresses carried input without queueing it for the results menu. */
export const RESULTS_INPUT_DELAY_MS = 1_000;
const STICK_THRESHOLD = 0.62;

export class ResultsInputGuard {
  private deadline: number | null = null;
  private readonly keys = new Set<string>();
  private readonly pads = new Map<number, { buttons: boolean[]; stickActive: boolean }>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  begin(): void { this.deadline = this.now() + RESULTS_INPUT_DELAY_MS; }
  end(): void { this.deadline = null; }
  ready(): boolean { return this.deadline === null || this.now() >= this.deadline; }

  keyDown(code: string, repeat: boolean): boolean {
    const fresh = !repeat && !this.keys.has(code);
    this.keys.add(code);
    return this.ready() && fresh;
  }

  keyUp(code: string): void { this.keys.delete(code); }

  /** Snapshot every physical control, even while actions are blocked. */
  freshGamepads(pads: readonly (Gamepad | null)[]): (Gamepad | null)[] {
    const connected = new Set(pads.filter(pad => pad?.connected).map(pad => pad!.index));
    for (const index of this.pads.keys()) if (!connected.has(index)) this.pads.delete(index);
    return pads.map(pad => {
      if (!pad?.connected) return pad;
      const previous = this.pads.get(pad.index);
      const buttons = pad.buttons.map(button => button.pressed);
      const stickActive = pad.axes.slice(0, 2).some(axis => Math.abs(axis) >= STICK_THRESHOLD);
      this.pads.set(pad.index, { buttons, stickActive });
      return {
        ...pad, id: pad.id, index: pad.index, connected: pad.connected, mapping: pad.mapping,
        buttons: pad.buttons.map((button, index) => ({
          pressed: button.pressed && !previous?.buttons[index],
          touched: button.touched, value: button.value,
        })),
        axes: stickActive && !previous?.stickActive ? Array.from(pad.axes) : pad.axes.map(() => 0),
      } as Gamepad;
    });
  }
}
