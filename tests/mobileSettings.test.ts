import { describe, expect, it } from 'vitest';
import { DEFAULT_MOBILE_SETTINGS, MOBILE_SETTINGS_KEY, loadMobileSettings, normalizeMobileSettings, saveMobileSettings } from '../src/ui/mobileSettings';

function memoryStorage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }; }
describe('mobile settings', () => {
  it('keeps three AI opponents and normalizes invalid values', () => {
    expect(normalizeMobileSettings({ aiCount: 3, inputMode: 'nope' })).toMatchObject({ aiCount: 3, inputMode: 'buttons' });
    expect(normalizeMobileSettings({ aiCount: 4 })).toEqual(DEFAULT_MOBILE_SETTINGS);
  });
  it('starts with defaults when the browser blocks localStorage access', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage() { throw new Error('blocked'); } } });
    try { expect(loadMobileSettings()).toEqual(DEFAULT_MOBILE_SETTINGS); } finally {
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window');
    }
  });
  it('defaults legacy preferences to reduced tilt sensitivity', () => {
    expect(normalizeMobileSettings({ inputMode: 'tilt', aiCount: 1, aiDifficulty: 'medium' })).toMatchObject({ inputMode: 'buttons', tiltSensitivity: 0.5 });
  });
  it('persists buttons and the three-AI roster', () => { const storage = memoryStorage(); expect(saveMobileSettings({ inputMode: 'buttons', aiCount: 3, aiDifficulty: 'hard', tiltSensitivity: 0.75 }, storage)).toBe(true); expect(JSON.parse(storage.getItem(MOBILE_SETTINGS_KEY)!)).toMatchObject({ aiCount: 3, tiltSensitivity: 0.75 }); expect(loadMobileSettings(storage)).toEqual({ inputMode: 'buttons', aiCount: 3, aiDifficulty: 'hard', tiltSensitivity: 0.75 }); });
});

it('migrates saved tilt mode to buttons without losing opponents', () => { const storage = memoryStorage(); storage.setItem(MOBILE_SETTINGS_KEY, JSON.stringify({ inputMode: 'tilt', aiCount: 3, aiDifficulty: 'hard' })); expect(loadMobileSettings(storage)).toMatchObject({ inputMode: 'buttons', aiCount: 3, aiDifficulty: 'hard' }); });
