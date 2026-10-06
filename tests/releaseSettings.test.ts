import { describe, expect, it } from 'vitest';
import { GameAudio } from '../src/audio/GameAudio';
import { DEFAULT_RELEASE_SETTINGS, RELEASE_SETTINGS_KEY, loadReleaseSettings, normalizeReleaseSettings, saveReleaseSettings, type ReleaseSettings } from '../src/ui/releaseSettings';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

describe('release settings', () => {
  it('uses safe defaults for absent or damaged data', () => {
    expect(loadReleaseSettings(memoryStorage())).toEqual(DEFAULT_RELEASE_SETTINGS);
    expect(loadReleaseSettings(memoryStorage({ [RELEASE_SETTINGS_KEY]: '{bad' }))).toEqual(DEFAULT_RELEASE_SETTINGS);
  });

  it('starts with defaults when the browser blocks localStorage access', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage() { throw new Error('blocked'); } } });
    try { expect(loadReleaseSettings()).toEqual(DEFAULT_RELEASE_SETTINGS); } finally {
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('migrates a legacy master level to both independent levels', () => {
    expect(normalizeReleaseSettings({ volume: 0.62, muted: true })).toEqual({
      music: 0.62, effects: 0.62, muted: true, calmEffects: false, musicDirection: 'neon-workshop', sfxDirection: 'soft-toy', sfxPreset: 'soft-toy',
    });
  });

  it('clamps, saves, and restores independent values', () => {
    const storage = memoryStorage();
    expect(saveReleaseSettings({ music: 1.4, effects: -1, muted: false, calmEffects: true, musicDirection: 'brickbeat', sfxDirection: 'arcade', sfxPreset: 'original' }, storage)).toBe(true);
    expect(loadReleaseSettings(storage)).toEqual({ music: 1, effects: 0, muted: false, calmEffects: true, musicDirection: 'brickbeat', sfxDirection: 'arcade', sfxPreset: 'original' });
  });

  it('saves and restores Quiet Mechanism with independent levels and legacy SFX direction', () => {
    const storage = memoryStorage();
    const settings: ReleaseSettings = { ...DEFAULT_RELEASE_SETTINGS, music: 0.73, effects: 0.28, muted: true, sfxDirection: 'construction', sfxPreset: 'quiet-mechanism' };
    expect(saveReleaseSettings(settings, storage)).toBe(true);
    expect(loadReleaseSettings(storage)).toEqual(settings);
  });

  it('migrates realistic and defaults invalid or missing SFX packs to Soft Toy', () => {
    expect(normalizeReleaseSettings({ sfxPreset: 'realistic' }).sfxPreset).toBe('soft-toy');
    expect(normalizeReleaseSettings({ sfxPreset: 'unknown' }).sfxPreset).toBe('soft-toy');
    expect(normalizeReleaseSettings({}).sfxPreset).toBe('soft-toy');
    expect(normalizeReleaseSettings({ sfxPreset: 'neon-workshop' }).sfxPreset).toBe('neon-workshop');
  });
});

describe('independent audio levels', () => {
  it('changes one user level without changing the other and preserves both through mute', async () => {
    const audio = new GameAudio(false, { music: 0.4, effects: 0.7, sfxPreset: 'soft-toy' });
    expect(audio.setMusicVolume(0.55)).toBe(0.55);
    expect(audio.getEffectsVolume()).toBe(0.7);
    expect(audio.setEffectsVolume(0.25)).toBe(0.25);
    expect(audio.getMusicVolume()).toBe(0.55);
    audio.toggleMuted();
    audio.toggleMuted();
    expect([audio.getMusicVolume(), audio.getEffectsVolume()]).toEqual([0.55, 0.25]);
    expect(await audio.setSfxPreset('original')).toBe('original');
    expect(audio.getSfxPreset()).toBe('original');
    expect([audio.getMusicVolume(), audio.getEffectsVolume()]).toEqual([0.55, 0.25]);
  });
});
