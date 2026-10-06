import type { GamepadController, TileStyleSelection } from '../domain/types';
import type { SlotSelection } from './slotPersistence';
export type RosterController = SlotSelection | GamepadController;
export interface RosterSlot {
  controller: RosterController;
  name: string;
  style: TileStyleSelection;
  profile: string | null;
}
export function gamepadDestination(slots: readonly RosterController[], controller: GamepadController): number {
  const source = slots.indexOf(controller);
  if (source < 0) return slots.indexOf('off');
  for (let step = 1; step < slots.length; step++) {
    const target = (source + step) % slots.length;
    const value = slots[target]!;
    if (value === 'off' || value.startsWith('ai-')) return target;
  }
  return -1;
}
export function moveGamepad(slots: readonly RosterSlot[], controller: GamepadController): RosterSlot[] | null {
  const source = slots.findIndex((slot) => slot.controller === controller);
  const target = gamepadDestination(slots.map((slot) => slot.controller), controller);
  if (source < 0 || target < 0) return null;
  const next = slots.map((slot) => ({ ...slot }));
  [next[source], next[target]] = [next[target]!, next[source]!];
  return next;
}
