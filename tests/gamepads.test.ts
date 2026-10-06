import { describe, expect, it } from 'vitest';
import { connectedGamepads, gamepadControls } from '../src/controllers/gamepads';

function gamepad(index: number, overrides: Partial<Gamepad> = {}): Gamepad {
  return {
    id: `Pad ${index}`,
    index,
    connected: true,
    axes: [0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 } as GamepadButton)),
    mapping: 'standard', timestamp: 0, vibrationActuator: null,
    hapticActuators: [],
    ...overrides,
  } as Gamepad;
}

describe('browser gamepad discovery', () => {
  it('lists every connected pad and tolerates unavailable API', () => {
    expect(connectedGamepads({} as Navigator)).toEqual([]);
    expect(connectedGamepads({ getGamepads: () => [gamepad(0), null, gamepad(2)] } as unknown as Navigator)).toEqual([
      { controller: 'gamepad-0', index: 0, label: 'Pad 0' },
      { controller: 'gamepad-2', index: 2, label: 'Pad 2' },
    ]);
  });

  it('normalizes stick, directional pad, and A/Cross into game actions', () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 } as GamepadButton));
    buttons[0] = { pressed: true, touched: true, value: 1 } as GamepadButton;
    buttons[13] = { pressed: true, touched: true, value: 1 } as GamepadButton;
    expect(gamepadControls(gamepad(0, { axes: [-0.7, 0], buttons }))).toEqual({ left: true, right: false, down: true, rotate: true });
  });
});
