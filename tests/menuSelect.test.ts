import { describe, expect, it } from 'vitest';
import { menuSelectCommandForKey, nextEnabledOptionIndex } from '../src/ui/menuSelect';

describe('menu select state helpers', () => {
  it('opens only on confirmation and maps expanded navigation', () => {
    expect(menuSelectCommandForKey('ArrowDown', false)).toBeNull();
    expect(menuSelectCommandForKey('Enter', false)).toBe('open');
    expect(menuSelectCommandForKey('ArrowDown', true)).toBe('next');
    expect(menuSelectCommandForKey('ArrowUp', true)).toBe('previous');
    expect(menuSelectCommandForKey('Enter', true)).toBe('commit');
    expect(menuSelectCommandForKey('Escape', true)).toBe('cancel');
  });

  it('wraps around disabled options without selecting them', () => {
    expect(nextEnabledOptionIndex([false, true, false], 0, 1)).toBe(2);
    expect(nextEnabledOptionIndex([false, true, false], 2, 1)).toBe(0);
    expect(nextEnabledOptionIndex([false, true, false], 0, -1)).toBe(2);
    expect(nextEnabledOptionIndex([true, true], 0, 1)).toBe(-1);
  });
});
