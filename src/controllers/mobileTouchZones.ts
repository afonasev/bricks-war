import type { GamepadControls } from './gamepads';

export type MobileTouchAction = keyof GamepadControls;
export const MOBILE_TOUCH_BUTTON_ZONE_FRACTION = 0.21875;

export function mobileTouchActionAt(x: number, y: number, width: number, height: number): MobileTouchAction {
  if (y < height * (1 - MOBILE_TOUCH_BUTTON_ZONE_FRACTION)) return 'rotate';
  if (x < width / 3) return 'left';
  if (x >= (width / 3) * 2) return 'right';
  return 'down';
}

export function combineMobileControls(touch: GamepadControls, tilt: GamepadControls): GamepadControls {
  const horizontal = (touch.left ? -1 : touch.right ? 1 : 0) + (tilt.left ? -1 : tilt.right ? 1 : 0);
  return { left: horizontal < 0, right: horizontal > 0, down: touch.down || tilt.down, rotate: touch.rotate || tilt.rotate };
}
