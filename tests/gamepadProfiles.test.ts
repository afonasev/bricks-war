import { describe, expect, it } from 'vitest';
import { GamepadProfiles, GAMEPAD_PROFILE_STORAGE_KEY, gamepadDescription } from '../src/ui/gamepadProfiles';
const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
describe('local gamepad name preferences', () => {
  it('restores the last normalized name independent of live index', () => {
    const storage = memory();
    const profiles = new GamepadProfiles(storage);
    const profile = profiles.create('same device', '  Александр  ');
    profiles.rename(profile.id, '  Новый   игрок  ');
    expect(new GamepadProfiles(storage).candidates('same device', new Set())[0]!.name).toBe('Новый игрок');
    const pad = { id: 'Pad', mapping: 'standard', buttons: [], axes: [], index: 0 } as unknown as Gamepad;
    expect(gamepadDescription(pad)).toBe(gamepadDescription({ ...pad, index: 4 }));
  });
  it('keeps equal names as separate profiles and excludes already assigned profiles', () => {
    const profiles = new GamepadProfiles(memory());
    const a = profiles.create('pad', 'Игрок');
    const b = profiles.create('pad', 'Игрок');
    expect(a.id).not.toBe(b.id);
    expect(profiles.candidates('pad', new Set([a.id]))).toEqual([b]);
  });
  it('remembers keyboard names across reload without duplicate history entries', () => {
    const storage = memory();
    const profiles = new GamepadProfiles(storage);
    profiles.rememberName('  Анна  ');
    profiles.rememberName('Анна');
    profiles.rememberName('Борис');
    expect(new GamepadProfiles(storage).profiles.map(profile => profile.name)).toEqual(['Анна', 'Борис']);
  });
  it('imports prior keyboard slot names once without resurrecting deleted history', () => {
    const storage = memory();
    const profiles = new GamepadProfiles(storage);
    profiles.importSlotNames(['Анна', 'Игрок 2', 'Анна', 'Игрок 4']);
    expect(profiles.profiles.map(profile => profile.name)).toEqual(['Анна']);
    profiles.remove(profiles.profiles[0]!.id);
    const reloaded = new GamepadProfiles(storage);
    reloaded.importSlotNames(['Анна', 'Игрок 2', 'Анна', 'Игрок 4']);
    expect(reloaded.profiles).toEqual([]);
  });
  it('removes a saved profile durably without removing another same-name profile', () => {
    const storage = memory();
    const profiles = new GamepadProfiles(storage);
    const a = profiles.create('pad', 'Имя');
    const b = profiles.create('pad', 'Имя');
    profiles.remove(a.id);
    expect(new GamepadProfiles(storage).profiles).toEqual([b]);
  });
  it('survives malformed and inaccessible storage without importing slot names', () => {
    const storage = memory();
    storage.setItem(GAMEPAD_PROFILE_STORAGE_KEY, '{oops');
    expect(new GamepadProfiles(storage).profiles).toEqual([]);
    const blocked = new GamepadProfiles({ getItem: () => { throw Error(); }, setItem: () => { throw Error(); } });
    const profile = blocked.create('pad', 'Имя');
    blocked.rename(profile.id, 'Другое');
    expect(blocked.profiles[0]!.name).toBe('Другое');
  });
});
