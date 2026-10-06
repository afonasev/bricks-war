import { describe, expect, it } from 'vitest';
import { ResultsInputGuard } from '../src/ui/resultsInputGuard';
import { gamepadMenuAction } from '../src/ui/menuNavigation';

function pad(index: number, pressed: number[] = [], axes = [0, 0]): Gamepad {
  return { id: `Pad ${index}`, index, connected: true, mapping: 'standard', timestamp: 0, vibrationActuator: null, axes,
    buttons: Array.from({ length: 16 }, (_, button) => ({ pressed: pressed.includes(button), touched: false, value: 0 })),
  } as unknown as Gamepad;
}

function fixture() {
  let time = 0;
  const guard = new ResultsInputGuard(() => time);
  return { guard, at: (value: number) => { time = value; } };
}

describe('results input protection', () => {
  it('unlocks at exactly one second and resets for each result', () => {
    const { guard, at } = fixture();
    guard.begin();
    at(999); expect(guard.ready()).toBe(false);
    at(1000); expect(guard.ready()).toBe(true);
    guard.begin(); at(1999); expect(guard.ready()).toBe(false);
    at(2000); expect(guard.ready()).toBe(true);
    guard.begin(); guard.end(); expect(guard.ready()).toBe(true);
  });

  it.each(['Enter', 'Space', 'Escape', 'ArrowDown'])('requires release of %s carried across results and drops autorepeat', code => {
    const { guard, at } = fixture();
    guard.keyDown(code, false);
    guard.begin(); at(500);
    expect(guard.keyDown(code, true)).toBe(false);
    at(1000);
    expect(guard.keyDown(code, false)).toBe(false);
    expect(guard.keyDown(code, true)).toBe(false);
    guard.keyUp(code);
    expect(guard.keyDown(code, false)).toBe(true);
  });

  it('discards presses during protection without blocking a different fresh key', () => {
    const { guard, at } = fixture();
    guard.begin();
    expect(guard.keyDown('Enter', false)).toBe(false);
    guard.keyUp('Enter'); at(1000);
    expect(guard.keyDown('Escape', false)).toBe(true);
    expect(guard.keyDown('Enter', false)).toBe(true);
  });

  it('tracks simultaneous physical buttons rather than the highest-priority menu action', () => {
    const { guard, at } = fixture();
    guard.freshGamepads([pad(0, [0, 1, 13])]); guard.begin();
    at(1000);
    expect(gamepadMenuAction(guard.freshGamepads([pad(0, [1, 13])])[0]!)).toBeNull();
    guard.freshGamepads([pad(0, [13])]);
    expect(gamepadMenuAction(guard.freshGamepads([pad(0, [1, 13])])[0]!)).toBe('back');
  });

  it('requires stick neutral even when changing directly to another direction', () => {
    const { guard, at } = fixture();
    guard.freshGamepads([pad(0, [], [0.8, 0])]); guard.begin(); at(1000);
    expect(gamepadMenuAction(guard.freshGamepads([pad(0, [], [-0.8, 0])])[0]!)).toBeNull();
    guard.freshGamepads([pad(0)]);
    expect(gamepadMenuAction(guard.freshGamepads([pad(0, [], [-0.8, 0])])[0]!)).toBe('decrease');
  });

  it('keeps gamepads independent and does not retain mutable browser snapshots', () => {
    const { guard, at } = fixture();
    const held = pad(0, [0]);
    guard.freshGamepads([held, pad(1)]); guard.begin(); at(1000);
    const fresh = guard.freshGamepads([held, pad(1, [0])]);
    expect(gamepadMenuAction(fresh[0]!)).toBeNull();
    expect(gamepadMenuAction(fresh[1]!)).toBe('confirm');
    (held.buttons[0] as { pressed: boolean }).pressed = false;
    guard.freshGamepads([held]);
    (held.buttons[0] as { pressed: boolean }).pressed = true;
    expect(gamepadMenuAction(guard.freshGamepads([held])[0]!)).toBe('confirm');
  });
});
