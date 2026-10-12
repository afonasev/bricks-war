import { describe, expect, it, vi } from 'vitest';
import { GameAudio } from '../src/audio/GameAudio';
import { SFX_PRESET_IDS } from '../src/audio/sfxPresets';

describe('requested charge and anomaly signal balance', () => {
  it.each(SFX_PRESET_IDS)('reduces charge gain by 20% through the shared Effects bus in %s', (sfxPreset) => {
    const audio = new GameAudio(false, { sfxPreset });
    const gains: { value: number }[] = [];
    const sources: { buffer: unknown; start: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }[] = [];
    const destination = {}, panner = { pan: { value: 0 }, connect: vi.fn() };
    const context = {
      currentTime: 10,
      createGain: () => { const gain = { value: 0 }; gains.push(gain); return { gain, connect: vi.fn() }; },
      createBufferSource: () => { const source = { buffer: null as unknown, start: vi.fn(), connect: vi.fn() }; sources.push(source); return source; },
      createStereoPanner: () => panner,
    };
    const charge = { duration: 1 }, other = { duration: 1 };
    const internal = audio as unknown as {
      playEvent(event: { type: string; pan: number }): void;
      playBoardSound(name: string, start: number, pan: number): void;
    };
    Object.assign(audio, { context, sfxBus: destination, boardEventBuffers: new Map([['charge', charge], ['anomaly', other], ['warning', other], ['shield', other]]) });
    internal.playEvent({ type: 'shield-full-charge', pan: -0.6 });
    expect(sources[0]!.buffer).toBe(charge);
    expect(sources[0]!.start).toHaveBeenCalledWith(10.008, 0);
    expect(gains[0]!.value).toBeCloseTo(0.8, 12);
    expect(panner.pan.value).toBe(-0.6);
    expect(panner.connect).toHaveBeenCalledWith(destination);
    for (const name of ['anomaly', 'warning', 'shield']) internal.playBoardSound(name, 1, 0);
    expect(gains.map(g => g.value)).toEqual([0.8, 1, 0.45, 1]);
  });

  it.each(SFX_PRESET_IDS)('reduces every arrival alarm tone by 20% in %s', (sfxPreset) => {
    const audio = new GameAudio(false, { sfxPreset });
    const internal = audio as unknown as {
      playEvent(event: { type: string; pan: number }): void;
      tone(...args: unknown[]): void;
    };
    Object.assign(audio, { context: { currentTime: 10 } });
    const tone = vi.spyOn(internal, 'tone').mockImplementation(() => {});
    internal.playEvent({ type: 'anomaly-spawn', pan: 0.4 });
    expect(tone).toHaveBeenCalledTimes(9);
    tone.mock.calls.forEach((call, index) => {
      expect(call[0]).toBe([1100, 1650, 2200][index % 3]);
      expect(call[1]).toBeCloseTo(10.008 + Math.floor(index / 3) * 0.28, 12);
      expect(call[3]).toBeCloseTo([0.076, 0.04, 0.0216][index % 3]!, 12);
      expect(call[5]).toBe(0.4);
    });
  });
});
