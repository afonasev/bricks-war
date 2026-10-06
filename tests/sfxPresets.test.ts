import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameAudio } from '../src/audio/GameAudio';
import type { FoleyKind } from '../src/audio/foley';
import {
  SFX_PACK_EVENT_IDS,
  SFX_PACKS,
  SOFT_TOY_SFX_SOURCE,
  SOFT_TOY_ASSET_IDS,
  createSoftToySfxLibrary,
  createQuietMechanismSfxLibrary,
  QUIET_MECHANISM_ASSET_IDS,
  SFX_PRESET_IDS,
  validateSfxPack,
  type SfxPack,
  type SfxPresetId,
  type SoftToyAssetId,
  type RecordedAssetId,
} from '../src/audio/sfxPresets';

interface StartedSource { buffer: AudioBuffer | null; playbackRate: { value: number }; startedAt?: number; stoppedAt?: number }

function audioHarness(preset: SfxPresetId = 'soft-toy') {
  const sources: StartedSource[] = [];
  const gains: Array<{ value: number }> = [];
  const pans: Array<{ value: number }> = [];
  const node = { connect: () => node } as unknown as AudioNode;
  const context = {
    currentTime: 4,
    createBufferSource: () => {
      const source: StartedSource & { connect: () => AudioNode; start: (at: number) => void; stop: (at: number) => void } = {
        buffer: null,
        playbackRate: { value: 1 },
        connect: () => node,
        start: (at) => { source.startedAt = at; },
        stop: (at) => { source.stoppedAt = at; },
      };
      sources.push(source);
      return source as unknown as AudioBufferSourceNode;
    },
    createGain: () => {
      const gain = { value: 0 };
      gains.push(gain);
      return { gain, connect: () => node } as unknown as GainNode;
    },
    createStereoPanner: () => {
      const pan = { value: 0 };
      pans.push(pan);
      return { pan, connect: () => node } as unknown as StereoPannerNode;
    },
    createBiquadFilter: () => ({ type: 'lowpass', frequency: { value: 0 }, connect: () => node }) as unknown as BiquadFilterNode,
  } as unknown as AudioContext;
  const buffers = (prefix: string): readonly AudioBuffer[] => [0, 1, 2].map((index) => ({ id: `${prefix}-${index}` }) as unknown as AudioBuffer);
  const original: Readonly<Record<FoleyKind, readonly AudioBuffer[]>> = {
    'plastic-click': buffers('original-click'), 'wood-contact': buffers('original-lock'),
    'rubber-landing': buffers('original-rubber'), slide: buffers('original-slide'),
  };
  const softToyBuffers = Object.fromEntries(SOFT_TOY_ASSET_IDS.map((id) => [id, { id: `soft-${id}` } as unknown as AudioBuffer])) as Record<SoftToyAssetId, AudioBuffer>;
  const quietMechanismBuffers = { ...softToyBuffers, ...Object.fromEntries(QUIET_MECHANISM_ASSET_IDS.map((id) => [id, { id } as unknown as AudioBuffer])) } as Record<RecordedAssetId, AudioBuffer>;
  const audio = new GameAudio(false, { sfxPreset: preset });
  const internals = audio as unknown as {
    context: AudioContext; sfxBus: AudioNode; foley: typeof original;
    softToyBuffers: typeof softToyBuffers | null; sfxPreset: SfxPresetId;
    quietMechanismBuffers: typeof quietMechanismBuffers | null;
    prepareSoftToy(context: AudioContext): Promise<boolean>;
    prepareQuietMechanism(context: AudioContext): Promise<boolean>;
    playRotate(start: number, pan: number): void;
    playLock(start: number, pan: number): void;
    playLineClear(start: number, lines: number, pan: number): void;
    previewSources: AudioScheduledSourceNode[];
  };
  Object.assign(internals, { context, sfxBus: node, foley: original, softToyBuffers, quietMechanismBuffers, sfxPreset: preset });
  return { audio, internals, sources, gains, pans };
}

describe('complete SFX pack registry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('covers the exact semantic catalogue in every pack', () => {
    for (const pack of Object.values(SFX_PACKS)) {
      expect(validateSfxPack(pack)).toBe(true);
      expect(Object.keys(pack.events).sort()).toEqual([...SFX_PACK_EVENT_IDS].sort());
      expect(pack.events.rotate).toHaveLength(3);
      expect(pack.events.lock).toHaveLength(3);
      expect(pack.events['line-clear']).toHaveLength(3);
    }
  });

  it('rejects an incomplete pack', () => {
    const incomplete = { ...SFX_PACKS.original, events: { ...SFX_PACKS.original.events, countdown: [] } } as unknown as SfxPack;
    expect(validateSfxPack(incomplete)).toBe(false);
  });

  it('adds a fourth recorded theme with independent tactile assets and explicit shared base', () => {
    expect(SFX_PRESET_IDS).toEqual(['soft-toy', 'neon-workshop', 'original', 'quiet-mechanism']);
    const quiet = SFX_PACKS['quiet-mechanism'];
    expect(quiet.label).toBe('Тихая механика');
    for (const event of SFX_PACK_EVENT_IDS) {
      if (event !== 'rotate' && event !== 'lock') expect(quiet.events[event]).toEqual(SFX_PACKS['soft-toy'].events[event]);
    }
    for (const event of ['rotate', 'lock'] as const) {
      expect(new Set(quiet.events[event].map((variant) => variant.asset)).size).toBe(3);
      expect(quiet.events[event].every((variant) => variant.gain === 1 && variant.playbackRate === 1 && !('lowpass' in variant))).toBe(true);
    }
  });

  it('decodes the six independent Quiet Mechanism recordings', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) }));
    vi.stubGlobal('fetch', fetcher);
    const decodeAudioData = vi.fn(async () => ({ duration: .2 } as AudioBuffer));
    const library = await createQuietMechanismSfxLibrary({ decodeAudioData } as unknown as AudioContext);
    expect(Object.keys(library)).toEqual([...QUIET_MECHANISM_ASSET_IDS]);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(decodeAudioData).toHaveBeenCalledTimes(6);
  });

  it('keeps Soft Toy entirely recorded with auditable source filenames', async () => {
    expect(SOFT_TOY_SFX_SOURCE.derivedFiles).toEqual(SOFT_TOY_ASSET_IDS.map((id) => `${id}.wav`));
    for (const variants of Object.values(SFX_PACKS['soft-toy'].events)) {
      expect(variants.every((variant) => 'asset' in variant && !('frequency' in variant))).toBe(true);
    }
    const decoded: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer })));
    const context = { decodeAudioData: async (data: ArrayBuffer) => {
      decoded.push(new TextDecoder().decode(data));
      return { duration: .2 } as AudioBuffer;
    } } as unknown as AudioContext;
    const library = await createSoftToySfxLibrary(context);
    expect(Object.keys(library).sort()).toEqual([...SOFT_TOY_ASSET_IDS].sort());
    expect(decoded).toHaveLength(SOFT_TOY_ASSET_IDS.length);
  });

  it('keeps Neon Workshop fully procedural, warm, and tiered', () => {
    const events = SFX_PACKS['neon-workshop'].events;
    const variants = Object.values(events).flat();
    expect(variants.every((variant) => 'frequency' in variant && !('asset' in variant))).toBe(true);
    expect(Math.max(...variants.map((variant) => variant.lowpass))).toBeLessThanOrEqual(2200);
    expect(events['conflict-impact'][0]!.gain).toBeGreaterThan(events.rotate[0]!.gain);
    expect(events['final-push'][0]!.duration).toBeGreaterThan(events['ui-select'][0]!.duration);
  });
});

describe('whole SFX pack playback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a saved buffered Quiet Mechanism preset pending until audio preparation', () => {
    expect(new GameAudio(false, { sfxPreset: 'quiet-mechanism' }).getSfxPreset()).toBe('original');
    expect(new GameAudio(false, { sfxPreset: 'neon-workshop' }).getSfxPreset()).toBe('neon-workshop');
  });

  it('plays Quiet Mechanism rotate and lock variants at unchanged times and rate', () => {
    const { internals, sources, pans, gains } = audioHarness('quiet-mechanism');
    for (let i = 0; i < 4; i += 1) internals.playRotate(2 + i * .14, .25);
    for (let i = 0; i < 3; i += 1) internals.playLock(3 + i * .6, -.5);
    expect(sources.map((s) => (s.buffer as unknown as { id: string }).id)).toEqual([
      'quiet-rotate-2', 'quiet-rotate-3', 'quiet-rotate-1', 'quiet-rotate-2',
      'quiet-lock-3', 'quiet-lock-1', 'quiet-lock-2',
    ]);
    expect(sources.map((s) => s.startedAt)).toEqual([2, 2.14, 2.2800000000000002, 2.42, 3, 3.6, 4.2]);
    expect(sources.every((s) => s.playbackRate.value === 1)).toBe(true);
    expect(pans.map((p) => p.value)).toEqual([.25, .25, .25, .25, -.5, -.5, -.5]);
    expect(gains.every((g) => g.value === 1)).toBe(true);
  });

  it('does not substitute Soft Toy when the Quiet Mechanism library is unavailable', () => {
    const { internals, sources } = audioHarness('quiet-mechanism');
    internals.quietMechanismBuffers = null;
    internals.playRotate(1, 0);
    internals.playLock(2, 0);
    internals.playLineClear(3, 2, 0);
    expect(sources).toHaveLength(0);
  });

  it('keeps the previous pack if Quiet Mechanism recordings fail while Soft Toy still prepares', async () => {
    const { audio, internals } = audioHarness('original');
    internals.quietMechanismBuffers = null;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    expect(await audio.setSfxPreset('quiet-mechanism')).toBe('original');
    expect(await audio.setSfxPreset('soft-toy')).toBe('soft-toy');
  });

  it('requires the shared library too before activating Quiet Mechanism', async () => {
    const { audio, internals } = audioHarness('original');
    internals.quietMechanismBuffers = null;
    internals.prepareSoftToy = async () => false;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(2) })));
    Object.assign(internals.context, { decodeAudioData: async () => ({ duration: .2 } as AudioBuffer) });
    expect(await audio.setSfxPreset('quiet-mechanism')).toBe('original');
  });

  it('does not activate a completed Quiet Mechanism request superseded by another selection', async () => {
    const { audio, internals } = audioHarness('original');
    let complete!: (ready: boolean) => void;
    internals.prepareQuietMechanism = () => new Promise((resolve) => { complete = resolve; });
    const pending = audio.setSfxPreset('quiet-mechanism');
    expect(await audio.setSfxPreset('neon-workshop')).toBe('neon-workshop');
    complete(true);
    expect(await pending).toBe('neon-workshop');
    expect(audio.getSfxPreset()).toBe('neon-workshop');
  });
  it('cycles deterministic Soft Toy variants with preserved timing and clamped pan', () => {
    const { internals, sources, pans } = audioHarness();
    internals.playRotate(2, -1.4); internals.playRotate(2.2, .25); internals.playRotate(2.4, 1.4);
    expect(new Set(sources.map((source) => (source.buffer as unknown as { id: string }).id)).size).toBe(3);
    expect(sources.map((source) => source.startedAt)).toEqual([2, 2.2, 2.4]);
    expect(pans.map((pan) => pan.value)).toEqual([-1, .25, 1]);
  });

  it('never falls back per event when the active buffered pack is unavailable', () => {
    const { internals, sources } = audioHarness();
    internals.softToyBuffers = null;
    internals.playRotate(1, 0);
    expect(sources).toHaveLength(0);
  });

  it('keeps the previous complete pack on failure and switches atomically after preparation', async () => {
    const { audio, internals } = audioHarness('original');
    const stale = { stop: (at: number) => { stale.stoppedAt = at; }, stoppedAt: -1 } as unknown as AudioScheduledSourceNode & { stoppedAt: number };
    internals.previewSources.push(stale);
    internals.prepareSoftToy = async () => false;
    expect(await audio.setSfxPreset('soft-toy')).toBe('original');
    expect(stale.stoppedAt).toBe(-1);
    internals.prepareSoftToy = async () => true;
    const before = [audio.getMusicVolume(), audio.getEffectsVolume()];
    expect(await audio.setSfxPreset('soft-toy')).toBe('soft-toy');
    expect(stale.stoppedAt).toBe(4);
    expect([audio.getMusicVolume(), audio.getEffectsVolume()]).toEqual(before);
  });

  it('keeps multi-hit line-clear spacing in Soft Toy', () => {
    const { internals, sources } = audioHarness();
    internals.playLineClear(3, 2, .4);
    expect(sources.map((source) => source.startedAt)).toEqual([3, 3.075, 3.15]);
    expect(sources.every((source) => (source.buffer as unknown as { id: string }).id.startsWith('soft-'))).toBe(true);
  });
});
