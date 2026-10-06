import { describe, expect, it } from 'vitest';
import { gamepadDestination, moveGamepad, type RosterSlot } from '../src/ui/gamepadRoster';
const roster = (): RosterSlot[] => [
  { controller: 'human-1', name: 'Клавиатура', style: 'random', profile: null },
  { controller: 'off', name: 'Игрок 2', style: 'random', profile: null },
  { controller: 'ai-expert', name: 'ИИ', style: 'random', profile: null },
  { controller: 'gamepad-0', name: 'Александр', style: 'random', profile: 'profile-A' },
];
describe('Y roster transitions', () => {
  it('joins only the first empty position and never displaces AI on first join', () => {
    expect(gamepadDestination(['human-1', 'ai-medium', 'off', 'off'], 'gamepad-0')).toBe(2);
    expect(gamepadDestination(['human-1', 'ai-medium'], 'gamepad-0')).toBe(-1);
  });
  it('wraps forward, skips people and carries player identity into an empty slot', () => {
    const before = roster();
    const next = moveGamepad(before, 'gamepad-0')!;
    expect(next[1]).toEqual(before[3]);
    expect(next[3]).toEqual(before[1]);
    expect(next[0]).toEqual(before[0]);
    expect(before[3]!.controller).toBe('gamepad-0');
  });
  it('exchanges complete configurations with AI including difficulty and style', () => {
    const before = roster();
    before[1]!.controller = 'human-2';
    before[2]!.style = 'sea-crystals';
    const next = moveGamepad(before, 'gamepad-0')!;
    expect(next[2]).toEqual(before[3]);
    expect(next[3]).toEqual(before[2]);
    expect(next.filter((slot) => slot.controller === 'gamepad-0')).toHaveLength(1);
  });
  it('keeps a roster with only humans unchanged', () => {
    const before = roster().map((slot, index) => ({ ...slot, controller: ['human-1', 'human-2', 'gamepad-1', 'gamepad-0'][index] as RosterSlot['controller'] }));
    expect(moveGamepad(before, 'gamepad-0')).toBeNull();
  });
});
