import { describe, expect, it } from 'vitest';
import { GamepadMenuLatch, gamepadMenuAction, keyboardMenuAction } from '../src/ui/menuNavigation';
import { ScreenRouter } from '../src/ui/screenRouter';

function gamepad(index: number, options: { axes?: number[]; pressed?: number[] } = {}): Gamepad {
  const pressed = new Set(options.pressed ?? []);
  return {
    id: `Pad ${index}`,
    index,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: options.axes ?? [0, 0],
    buttons: Array.from({ length: 16 }, (_, button) => ({ pressed: pressed.has(button), touched: false, value: pressed.has(button) ? 1 : 0 })),
    vibrationActuator: null,
  } as unknown as Gamepad;
}

describe('production screen routing', () => {
  it('returns mode screens to the main menu and nested screens to their parent', () => {
    const router = new ScreenRouter();
    router.open('battle');
    expect(router.back()).toBe('main-menu');
    router.open('settings');
    router.open('controls');
    expect(router.back()).toBe('settings');
  });

  it('supports Pause-owned Settings and restores a remembered selection safely', () => {
    const router = new ScreenRouter();
    router.open('arena');
    router.open('pause', 'arena');
    router.open('settings', 'pause');
    expect(router.back()).toBe('pause');
    router.rememberSelection('main-menu', 3);
    expect(router.selectionFor('main-menu', 4)).toBe(3);
    expect(router.selectionFor('main-menu', 2)).toBe(1);
  });
});

describe('shared menu input', () => {
  it('maps arrows, WASD, confirm, and back consistently', () => {
    expect(['ArrowUp', 'a', 'ArrowDown', 'd', 'Enter', ' ', 'Escape'].map(keyboardMenuAction)).toEqual([
      'previous', 'previous', 'next', 'next', 'confirm', 'confirm', 'back',
    ]);
    expect(keyboardMenuAction('Backspace')).toBeNull();
  });

  it('accepts D-pad and stick navigation from any connected gamepad', () => {
    expect(gamepadMenuAction(gamepad(0, { pressed: [14] }))).toBe('decrease');
    expect(gamepadMenuAction(gamepad(1, { axes: [0.8, 0] }))).toBe('increase');
    expect(gamepadMenuAction(gamepad(2, { pressed: [0] }))).toBe('confirm');
    expect(gamepadMenuAction(gamepad(3, { pressed: [1] }))).toBe('back');
    expect(gamepadMenuAction(gamepad(4, { pressed: [2] }))).toBe('start');
  });

  it('emits one action per deliberate input and ignores stick drift or inactive screens', () => {
    const latch = new GamepadMenuLatch();
    const held = gamepad(2, { axes: [0, 0.8] });
    expect(latch.read([null, held], true)).toBe('next');
    expect(latch.lastGamepadIndex()).toBe(2);
    expect(latch.read([null, held], true)).toBeNull();
    expect(latch.read([gamepad(2, { axes: [0.2, 0.25] })], true)).toBeNull();
    expect(latch.read([held], true)).toBe('next');
    expect(latch.read([held], false)).toBeNull();
  });

  it('keeps non-owner gamepads out of menu navigation while reporting their A press', () => {
    const latch = new GamepadMenuLatch();
    const ignored: Array<[number, string]> = [];
    expect(latch.read(
      [gamepad(1, { pressed: [0] }), gamepad(0, { pressed: [13] })],
      true,
      (index) => index === 0,
      (index, action) => ignored.push([index, action ?? '']),
    )).toBe('next');
    expect(latch.lastGamepadIndex()).toBe(0);
    expect(ignored).toEqual([[1, 'confirm']]);
  });
});


describe('independent Y press edges', () => {
  it('processes both devices in one frame regardless of navigation owner and holds', () => {
    const latch = new GamepadMenuLatch();
    const actions: number[] = [];
    const pads = [gamepad(0, { pressed: [0, 3] }), gamepad(1, { pressed: [3] })];
    const read = (enabled = true) => latch.read(pads, enabled, (index) => index === 0, undefined, (index) => actions.push(index));
    expect(read()).toBe('confirm');
    read();
    expect(actions).toEqual([0, 1]);
    latch.read([gamepad(0), gamepad(1)], true);
    read();
    expect(actions).toEqual([0, 1, 0, 1]);
  });
  it('does not convert a held gameplay Y into a lobby press and clears disconnected devices', () => {
    const latch = new GamepadMenuLatch();
    const actions: number[] = [];
    const pad = gamepad(0, { pressed: [3] });
    latch.read([pad], false, undefined, undefined, (index) => actions.push(index));
    latch.read([pad], true, undefined, undefined, (index) => actions.push(index));
    expect(actions).toEqual([]);
    latch.read([], true);
    latch.read([pad], true, undefined, undefined, (index) => actions.push(index));
    expect(actions).toEqual([0]);
  });
});
