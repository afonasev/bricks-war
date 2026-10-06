import type { GamepadController } from '../domain/types';

export interface ConnectedGamepad {
  controller: GamepadController;
  index: number;
  label: string;
}

export interface GamepadControls {
  left: boolean;
  right: boolean;
  down: boolean;
  rotate: boolean;
}

const STICK_THRESHOLD = 0.5;
const buttonPressed = (gamepad: Gamepad, index: number): boolean => gamepad.buttons[index]?.pressed ?? false;

export function connectedGamepads(source: Navigator = navigator): ConnectedGamepad[] {
  const gamepads = typeof source.getGamepads === 'function' ? source.getGamepads() : [];
  return Array.from(gamepads).flatMap((gamepad) => gamepad?.connected ? [{
    controller: `gamepad-${gamepad.index}` as GamepadController,
    index: gamepad.index,
    label: gamepad.id.trim() || `Геймпад ${gamepad.index + 1}`,
  }] : []);
}

export function gamepadControls(gamepad: Gamepad): GamepadControls {
  const horizontal = gamepad.axes[0] ?? 0;
  const vertical = gamepad.axes[1] ?? 0;
  return {
    left: buttonPressed(gamepad, 14) || horizontal <= -STICK_THRESHOLD,
    right: buttonPressed(gamepad, 15) || horizontal >= STICK_THRESHOLD,
    down: buttonPressed(gamepad, 13) || vertical >= STICK_THRESHOLD,
    rotate: buttonPressed(gamepad, 0),
  };
}
