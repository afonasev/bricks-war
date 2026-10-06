export const RELEASE_SETTINGS_KEY = 'bricks-war:release-settings:v1';
export const DEFAULT_RELEASE_SETTINGS = Object.freeze({
  music: 0.85,
  effects: 0.85,
  muted: false,
  calmEffects: false,
  musicDirection: 'neon-workshop' as MusicDirectionId,
  sfxDirection: 'soft-toy' as SfxDirectionId,
  sfxPreset: 'soft-toy' as SfxPresetId,
});

export interface ReleaseSettings {
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
  const rawSfxPreset = (value as { sfxPreset?: unknown }).sfxPreset;
  const migratedSfxPreset = rawSfxPreset === 'realistic' ? 'soft-toy' : rawSfxPreset;
  return {
    music: level(stored.music, legacy),
    effects: level(stored.effects, legacy),
    muted: typeof stored.muted === 'boolean' ? stored.muted : false,
    calmEffects: typeof stored.calmEffects === 'boolean' ? stored.calmEffects : false,
    musicDirection: ['neon-workshop', 'toybox-tactics', 'arcade-skyline', 'glass-gravity', 'brickbeat'].includes(stored.musicDirection ?? '') ? stored.musicDirection as MusicDirectionId : DEFAULT_RELEASE_SETTINGS.musicDirection,
    sfxDirection: ['soft-toy', 'construction', 'arcade', 'glassy-future'].includes(stored.sfxDirection ?? '') ? stored.sfxDirection as SfxDirectionId : DEFAULT_RELEASE_SETTINGS.sfxDirection,
    sfxPreset: isSfxPresetId(migratedSfxPreset) ? migratedSfxPreset : DEFAULT_RELEASE_SETTINGS.sfxPreset,
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
import { isSfxPresetId, type SfxPresetId } from '../audio/sfxPresets';
