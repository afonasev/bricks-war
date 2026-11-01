import { describe, expect, it, vi } from 'vitest';
import { bindMenuAudio } from '../src/ui/menuAudio';
import { GameAudio } from '../src/audio/GameAudio';

describe('menu audio startup', () => {
  it('starts native menu music before any input and does not restart on input', () => {
    const root = new EventTarget();
    const calls: string[] = [];
    bindMenuAudio(root, { unlock: () => calls.push('unlock'), enterMenu: () => calls.push('menu') }, () => calls.push('refresh'), true);
    expect(calls).toEqual(['unlock', 'menu', 'refresh']);
    root.dispatchEvent(new Event('pointerdown'));
    root.dispatchEvent(new Event('keydown'));
    expect(calls).toEqual(['unlock', 'menu', 'refresh']);
  });

  it.each(['pointerdown', 'keydown'])('keeps web music waiting for %s and removes both gesture listeners', (gesture) => {
    const root = new EventTarget();
    const audio = { unlock: vi.fn(), enterMenu: vi.fn() };
    const refresh = vi.fn();
    bindMenuAudio(root, audio, refresh, false);
    expect(audio.unlock).not.toHaveBeenCalled();
    expect(audio.enterMenu).not.toHaveBeenCalled();
    root.dispatchEvent(new Event(gesture));
    root.dispatchEvent(new Event('pointerdown'));
    root.dispatchEvent(new Event('keydown'));
    expect(audio.unlock).toHaveBeenCalledTimes(1);
    expect(audio.enterMenu).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('preserves saved mute and volume during native startup', () => {
    const audio = new GameAudio(true, { master: 0.4, music: 0.2, effects: 0.6 });
    bindMenuAudio(new EventTarget(), audio, () => {}, true);
    expect(audio.isMuted()).toBe(true);
    expect(audio.getMasterVolume()).toBe(0.4);
    expect(audio.getMusicVolume()).toBe(0.2);
    expect(audio.getEffectsVolume()).toBe(0.6);
  });

  it('cannot enable sound in a startup-muted native session, even after input', () => {
    const audio = new GameAudio(false, {}, true);
    const root = new EventTarget();
    bindMenuAudio(root, audio, () => {}, false);
    root.dispatchEvent(new Event('pointerdown'));
    expect(audio.isMuted()).toBe(true);
    expect(audio.toggleMuted()).toBe(true);
    expect((audio as unknown as { context: unknown }).context).toBeNull();
  });
});
