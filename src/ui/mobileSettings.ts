import type { AiDifficulty } from '../domain/types';

export const MOBILE_SETTINGS_KEY = 'bricks-war:mobile-settings:v1';
export type MobileInputMode = 'buttons';
export type TiltSensitivity = 0.5 | 0.75 | 1;
export interface MobileSettings { inputMode: MobileInputMode; aiCount: 1 | 2 | 3; aiDifficulty: AiDifficulty; tiltSensitivity: TiltSensitivity; }
export const DEFAULT_MOBILE_SETTINGS: Readonly<MobileSettings> = Object.freeze({ inputMode: 'buttons', aiCount: 1, aiDifficulty: 'medium', tiltSensitivity: 0.5 });
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
function browserStorage(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
export function normalizeMobileSettings(value: unknown): MobileSettings {
  const raw = value && typeof value === 'object' ? value as Partial<MobileSettings> : {};
  return {
    inputMode: 'buttons',
    aiCount: raw.aiCount === 3 ? 3 : raw.aiCount === 2 ? 2 : 1,
    aiDifficulty: ['easy', 'medium', 'hard', 'expert'].includes(raw.aiDifficulty ?? '') ? raw.aiDifficulty as AiDifficulty : 'medium',
    tiltSensitivity: raw.tiltSensitivity === 0.75 || raw.tiltSensitivity === 1 ? raw.tiltSensitivity : 0.5,
  };
}
export function loadMobileSettings(storage: StorageLike | null = browserStorage()): MobileSettings {
  try { return normalizeMobileSettings(storage ? JSON.parse(storage.getItem(MOBILE_SETTINGS_KEY) ?? 'null') : null); } catch { return { ...DEFAULT_MOBILE_SETTINGS }; }
}
export function saveMobileSettings(settings: MobileSettings, storage: StorageLike | null = browserStorage()): boolean {
  try { storage?.setItem(MOBILE_SETTINGS_KEY, JSON.stringify(normalizeMobileSettings(settings))); return Boolean(storage); } catch { return false; }
}

export function isMobilePlayViewport(viewport: Pick<Window, 'innerWidth' | 'innerHeight'> = window): boolean {
  return viewport.innerWidth <= 760 || (viewport.innerWidth <= 900 && viewport.innerHeight <= 600);
}
