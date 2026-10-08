import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GameAudio } from '../src/audio/GameAudio';
import { shieldEnergyBuffer, shieldEnergySamples } from '../src/audio/shieldEnergy';
import { SFX_PACKS } from '../src/audio/sfxPresets';

describe('approved energy shield sound', () => {
  it('preserves every approved PCM sample with no clipping or trailing noise', () => {
    const wav = readFileSync(new URL('../src/audio/assets/shield-energy.wav', import.meta.url));
    const samples = shieldEnergySamples();
    expect(samples.length).toBe(33600);
    for (let i = 0; i < samples.length; i++) expect(samples[i]).toBe(wav.readInt16LE(44 + i * 2) / 32768);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThan(0.9);
    expect(samples.slice(24960).every(v => v === 0)).toBe(true);
    const copy = vi.fn(); const buffer = { copyToChannel: copy };
    const context = { createBuffer: vi.fn(() => buffer) };
    expect(shieldEnergyBuffer(context as unknown as AudioContext)).toBe(buffer);
    expect(context.createBuffer).toHaveBeenCalledWith(1, 33600, 48000);
    expect(copy).toHaveBeenCalledWith(samples, 0);
  });

  it.each(Object.keys(SFX_PACKS))('uses the approved sound once through Effects with participant pan for %s', preset => {
    const source = { buffer: null, playbackRate: { value: 0 }, connect: vi.fn(), start: vi.fn() };
    const gain = { gain: { value: 0 }, connect: vi.fn() };
    const pan = { pan: { value: 0 }, connect: vi.fn() };
    const context = { createBufferSource: () => source, createGain: () => gain, createStereoPanner: () => pan };
    const approved = {}; const bus = {};
    const audio = new GameAudio();
    Object.assign(audio, { context, sfxBus: bus, shieldEnergyBuffer: approved, sfxPreset: preset });
    const internals = audio as unknown as { playShieldBlock: (start: number, pan: number) => void };
    internals.playShieldBlock(10, -.65);
    expect(source.buffer).toBe(approved);
    expect(source.start).toHaveBeenCalledExactlyOnceWith(10);
    expect(source.playbackRate.value).toBe(1);
    expect(gain.gain.value).toBe(.75);
    expect(pan.pan.value).toBe(-.65);
    expect(pan.connect).toHaveBeenCalledWith(bus);
  });
});
