import { DEFAULT_PLAYER_NAMES, normalizePlayerName } from './playerNamePersistence';

export const GAMEPAD_PROFILE_STORAGE_KEY = 'bricks-war:gamepad-profiles:v2';
export interface GamepadProfile { id: string; device: string; name: string }
type ProfileStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function gamepadDescription(pad: Gamepad): string {
  return JSON.stringify([pad.id, pad.mapping, pad.buttons.length, pad.axes.length]);
}
function storageOrNull(): ProfileStorage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Profiles are local name preferences, never physical device identities. */
export class GamepadProfiles {
  readonly profiles: GamepadProfile[] = [];
  constructor(private readonly storage: ProfileStorage | null = storageOrNull()) {
    try {
      const data: unknown = JSON.parse(storage?.getItem(GAMEPAD_PROFILE_STORAGE_KEY) ?? 'null');
      if (!Array.isArray(data)) return;
      const ids = new Set<string>();
      for (const item of data) {
        if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)
          || typeof item.device !== 'string' || typeof item.name !== 'string') continue;
        ids.add(item.id);
        this.profiles.push({ id: item.id, device: item.device, name: normalizePlayerName(item.name, 0) });
      }
    } catch { /* Inaccessible storage does not prevent in-memory names. */ }
  }
  candidates(device: string, assigned: ReadonlySet<string>): GamepadProfile[] {
    return this.profiles.filter((profile) => profile.device === device && !assigned.has(profile.id));
  }
  create(device: string, name: string): GamepadProfile {
    const profile = { id: crypto.randomUUID(), device, name: normalizePlayerName(name, 0) };
    this.profiles.push(profile);
    this.save();
    return profile;
  }
  importSlotNames(names: readonly string[]): void {
    const key = 'bricks-war:slot-name-history-imported:v1';
    try {
      if (this.storage?.getItem(key)) return;
      names.forEach((name, index) => {
        if (name !== DEFAULT_PLAYER_NAMES[index]) this.rememberName(name);
      });
      this.storage?.setItem(key, '1');
    } catch { /* History is optional when storage is inaccessible. */ }
  }
  rememberName(name: string): void {
    const normalized = normalizePlayerName(name, 0);
    if (!this.profiles.some((profile) => profile.name === normalized)) this.create('keyboard', normalized);
  }
  rename(id: string, name: string): void {
    const profile = this.profiles.find((item) => item.id === id);
    if (profile) { profile.name = normalizePlayerName(name, 0); this.save(); }
  }
  remove(id: string): void {
    const index = this.profiles.findIndex((profile) => profile.id === id);
    if (index >= 0) { this.profiles.splice(index, 1); this.save(); }
  }
  private save(): void {
    try { this.storage?.setItem(GAMEPAD_PROFILE_STORAGE_KEY, JSON.stringify(this.profiles)); } catch { /* Memory fallback. */ }
  }
}
