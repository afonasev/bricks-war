export const RELEASE_SETTINGS_KEY = 'bricks-war:release-settings:v1';
export const DEFAULT_RELEASE_SETTINGS = Object.freeze({
  antialias: true,
  fpsLimit: 0,
  master: 1,
  stickSensitivity: 1,
  stickDeadzone: 0,
  music: 0.85,
  effects: 0.85,
  muted: false,
  calmEffects: false,
  musicDirection: 'neon-workshop' as MusicDirectionId,
  sfxDirection: 'soft-toy' as SfxDirectionId,
  sfxPreset: 'soft-toy' as SfxPresetId,
});

export interface ReleaseSettings {
  antialias: boolean;
  fpsLimit: number;
  master: number;
  stickSensitivity: number;
  stickDeadzone: number;
  music: number;
  effects: number;
  muted: boolean;
  calmEffects: boolean;
  musicDirection: MusicDirectionId;
  sfxDirection: SfxDirectionId;
  sfxPreset: SfxPresetId;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

function level(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

export function normalizeReleaseSettings(value: unknown): ReleaseSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_RELEASE_SETTINGS };
  const stored = value as Partial<ReleaseSettings> & { volume?: unknown; masterVolume?: unknown };
  const legacy = level(stored.volume ?? stored.masterVolume, DEFAULT_RELEASE_SETTINGS.music);
  return {
    antialias: typeof stored.antialias === 'boolean' ? stored.antialias : true,
    fpsLimit: [0,30,60,120].includes(stored.fpsLimit ?? -1) ? stored.fpsLimit! : 0,
    master: level(stored.master, stored.muted === true ? 0 : 1),
    stickSensitivity: typeof stored.stickSensitivity === 'number' && Number.isFinite(stored.stickSensitivity) ? Math.max(0.5, Math.min(2, stored.stickSensitivity)) : 1,
    stickDeadzone: Math.min(0.5, level(stored.stickDeadzone, 0)),
    music: level(stored.music, legacy),
    effects: level(stored.effects, legacy),
    muted: false,
    calmEffects: typeof stored.calmEffects === 'boolean' ? stored.calmEffects : false,
    musicDirection: ['neon-workshop', 'toybox-tactics', 'arcade-skyline', 'glass-gravity', 'brickbeat'].includes(stored.musicDirection ?? '') ? stored.musicDirection as MusicDirectionId : DEFAULT_RELEASE_SETTINGS.musicDirection,
    sfxDirection: ['soft-toy', 'construction', 'arcade', 'glassy-future'].includes(stored.sfxDirection ?? '') ? stored.sfxDirection as SfxDirectionId : DEFAULT_RELEASE_SETTINGS.sfxDirection,
    sfxPreset: DEFAULT_RELEASE_SETTINGS.sfxPreset,
  };
}

export function loadReleaseSettings(storage: StorageLike | null = browserStorage()): ReleaseSettings {
  if (!storage) return { ...DEFAULT_RELEASE_SETTINGS };
  try {
    return normalizeReleaseSettings(JSON.parse(storage.getItem(RELEASE_SETTINGS_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_RELEASE_SETTINGS };
  }
}

export function saveReleaseSettings(settings: ReleaseSettings, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(RELEASE_SETTINGS_KEY, JSON.stringify(normalizeReleaseSettings(settings)));
    return true;
  } catch {
    return false;
  }
}
import type { MusicDirectionId, SfxDirectionId } from '../audio/audioDirections';
import type { SfxPresetId } from '../audio/sfxPresets';
