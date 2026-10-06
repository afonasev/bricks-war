import closeUrl from '../assets/audio/realistic-sfx/close.wav?url';
import drop1Url from '../assets/audio/realistic-sfx/drop1.wav?url';
import drop2Url from '../assets/audio/realistic-sfx/drop2.wav?url';
import drop3Url from '../assets/audio/realistic-sfx/drop3.wav?url';
import drop4Url from '../assets/audio/realistic-sfx/drop4.wav?url';
import drop5Url from '../assets/audio/realistic-sfx/drop5.wav?url';
import openUrl from '../assets/audio/realistic-sfx/open.wav?url';
import pickupUrl from '../assets/audio/realistic-sfx/pickup.wav?url';
import quietRotate1Url from '../assets/audio/quiet-mechanism/rotate-1.wav?url';
import quietRotate2Url from '../assets/audio/quiet-mechanism/rotate-2.wav?url';
import quietRotate3Url from '../assets/audio/quiet-mechanism/rotate-3.wav?url';
import quietLock1Url from '../assets/audio/quiet-mechanism/lock-1.wav?url';
import quietLock2Url from '../assets/audio/quiet-mechanism/lock-2.wav?url';
import quietLock3Url from '../assets/audio/quiet-mechanism/lock-3.wav?url';
import { fromEntries } from '../runtime/compat';

export const SFX_PRESET_IDS = ['soft-toy', 'neon-workshop', 'original', 'quiet-mechanism'] as const;
export type SfxPresetId = typeof SFX_PRESET_IDS[number];

export const SFX_PACK_EVENT_IDS = [
  'ui-select', 'ui-confirm', 'ui-back', 'ui-error',
  'countdown', 'round-start', 'rotate', 'lock', 'line-clear', 'level-up',
  'anomaly-spawn', 'final-tick', 'pressure', 'conflict-launch', 'conflict-impact',
  'cleanup', 'shield-half-charge', 'shield-full-charge', 'shield-block',
  'active-defense', 'final-push', 'eliminated', 'results-win', 'results-lose',
] as const;
export type SfxPackEventId = typeof SFX_PACK_EVENT_IDS[number];

export const SOFT_TOY_ASSET_IDS = ['pickup', 'open', 'close', 'drop1', 'drop2', 'drop3', 'drop4', 'drop5'] as const;
export type SoftToyAssetId = typeof SOFT_TOY_ASSET_IDS[number];
export const QUIET_MECHANISM_ASSET_IDS = ['quiet-rotate-1', 'quiet-rotate-2', 'quiet-rotate-3', 'quiet-lock-1', 'quiet-lock-2', 'quiet-lock-3'] as const;
export type QuietMechanismAssetId = typeof QUIET_MECHANISM_ASSET_IDS[number];
export type RecordedAssetId = SoftToyAssetId | QuietMechanismAssetId;

export interface SoftToyVariant { asset: SoftToyAssetId; gain: number; playbackRate: number; lowpass?: number }
export interface RecordedVariant { asset: RecordedAssetId; gain: number; playbackRate: number; lowpass?: number }
export interface NeonVariant { frequency: number; endFrequency?: number; duration: number; gain: number; waveform: OscillatorType; lowpass: number; noise?: number }

interface SoftToyPack { id: 'soft-toy'; label: 'Soft Toy'; kind: 'buffered'; events: Readonly<Record<SfxPackEventId, readonly SoftToyVariant[]>> }
interface QuietMechanismPack { id: 'quiet-mechanism'; label: 'Тихая механика'; kind: 'buffered'; events: Readonly<Record<SfxPackEventId, readonly RecordedVariant[]>> }
interface NeonPack { id: 'neon-workshop'; label: 'Neon Workshop'; kind: 'procedural'; events: Readonly<Record<SfxPackEventId, readonly NeonVariant[]>> }
interface OriginalPack { id: 'original'; label: 'Original'; kind: 'original'; events: Readonly<Record<SfxPackEventId, readonly { readonly renderer: 'original' }[]>> }
export type SfxPack = SoftToyPack | QuietMechanismPack | NeonPack | OriginalPack;

const soft = (asset: SoftToyAssetId, gain: number, playbackRate = 1, lowpass = 2400): SoftToyVariant => ({ asset, gain, playbackRate, lowpass });
const neon = (frequency: number, duration: number, gain: number, endFrequency = frequency, waveform: OscillatorType = 'sine', lowpass = 1800, noise = 0): NeonVariant => ({ frequency, endFrequency, duration, gain, waveform, lowpass, noise });

const softToyEvents = {
  'ui-select': [soft('pickup', .13, 1.08, 2200), soft('open', .12, 1.12, 2300), soft('close', .11, 1.16)],
  'ui-confirm': [soft('close', .16, .98), soft('drop1', .14, 1.08), soft('pickup', .15, .92)],
  'ui-back': [soft('open', .13, .88), soft('pickup', .12, .82), soft('close', .12, .78)],
  'ui-error': [soft('drop2', .2, .68, 1500), soft('drop3', .19, .64, 1450), soft('drop1', .2, .62, 1400)],
  countdown: [soft('pickup', .17, .88, 1900), soft('open', .17, .84, 1850), soft('close', .17, .8, 1800)],
  'round-start': [soft('drop1', .2, 1.12), soft('drop4', .18, 1.18), soft('close', .18, 1.24)],
  rotate: [soft('pickup', .16, .96), soft('open', .15, 1.04), soft('close', .15, 1.1)],
  lock: [soft('drop1', .22, .94, 2100), soft('drop2', .21, 1, 2200), soft('drop3', .2, 1.05, 2300)],
  'line-clear': [soft('drop3', .18, 1.06), soft('drop4', .18, 1.12), soft('drop5', .17, 1.18)],
  'level-up': [soft('pickup', .18, 1.22), soft('open', .17, 1.28), soft('drop4', .16, 1.34)],
  'anomaly-spawn': [soft('open', .2, .66, 1600), soft('drop5', .18, .72, 1700), soft('pickup', .18, .7, 1650)],
  'final-tick': [soft('close', .2, 1.18), soft('pickup', .19, 1.22), soft('open', .19, 1.26)],
  pressure: [soft('drop5', .24, .62, 1150), soft('drop4', .23, .58, 1100), soft('drop3', .23, .55, 1050)],
  'conflict-launch': [soft('pickup', .2, .82), soft('open', .2, .78), soft('drop1', .19, .9)],
  'conflict-impact': [soft('drop5', .28, .72, 1350), soft('drop4', .27, .76, 1450), soft('drop3', .27, .8, 1500)],
  cleanup: [soft('open', .18, 1.12), soft('pickup', .17, 1.18), soft('close', .17, 1.22)],
  'shield-half-charge': [soft('pickup', .17, 1.08), soft('open', .16, 1.12), soft('close', .16, 1.16)],
  'shield-full-charge': [soft('drop1', .19, 1.18), soft('pickup', .18, 1.28), soft('close', .17, 1.36)],
  'shield-block': [soft('drop2', .25, .78, 1500), soft('drop3', .24, .82, 1550), soft('drop4', .23, .86, 1600)],
  'active-defense': [soft('close', .21, 1.02), soft('drop1', .2, 1.08), soft('pickup', .19, 1.12)],
  'final-push': [soft('drop5', .25, .8, 1500), soft('drop1', .22, 1.04), soft('close', .2, 1.24)],
  eliminated: [soft('drop5', .22, .58, 1200), soft('drop4', .21, .54, 1150), soft('open', .19, .62, 1250)],
  'results-win': [soft('drop1', .2, 1.16), soft('pickup', .19, 1.3), soft('close', .18, 1.42)],
  'results-lose': [soft('drop4', .2, .68, 1300), soft('drop5', .21, .62, 1200), soft('open', .18, .74, 1350)],
} satisfies Record<SfxPackEventId, readonly SoftToyVariant[]>;

// The selected audition has gain/filter baked into each recording. Other
// events deliberately retain the common recorded base, with no runtime fallback.
const quietMechanismEvents = {
  ...softToyEvents,
  rotate: QUIET_MECHANISM_ASSET_IDS.slice(0, 3).map((asset): RecordedVariant => ({ asset, gain: 1, playbackRate: 1 })),
  lock: QUIET_MECHANISM_ASSET_IDS.slice(3).map((asset): RecordedVariant => ({ asset, gain: 1, playbackRate: 1 })),
} satisfies Record<SfxPackEventId, readonly RecordedVariant[]>;

const neonEvents = {
  'ui-select': [neon(330, .08, .04, 410), neon(350, .08, .04, 435), neon(370, .08, .04, 455)],
  'ui-confirm': [neon(392, .14, .055, 587), neon(415, .14, .055, 622), neon(440, .14, .055, 660)],
  'ui-back': [neon(370, .12, .045, 277), neon(350, .12, .045, 262), neon(330, .12, .045, 247)],
  'ui-error': [neon(196, .2, .075, 147, 'triangle', 1200, .012)],
  countdown: [neon(294, .15, .07, 294, 'sine', 1500, .008), neon(330, .15, .07, 330, 'sine', 1550, .008), neon(370, .15, .07, 370, 'sine', 1600, .008)],
  'round-start': [neon(392, .32, .085, 784, 'triangle', 2100, .012)],
  rotate: [neon(220, .08, .045, 275), neon(233, .08, .045, 291), neon(247, .08, .045, 309)],
  lock: [neon(147, .16, .075, 92, 'triangle', 1100, .012), neon(156, .16, .073, 98, 'triangle', 1150, .012), neon(165, .16, .071, 104, 'triangle', 1200, .012)],
  'line-clear': [neon(262, .22, .065, 392, 'sine', 1900, .008), neon(277, .22, .064, 415, 'sine', 1950, .008), neon(294, .22, .063, 440, 'sine', 2000, .008)],
  'level-up': [neon(330, .38, .08, 660, 'triangle', 2200, .012)],
  'anomaly-spawn': [neon(185, .5, .08, 370, 'sine', 1450, .025)],
  'final-tick': [neon(523, .12, .09, 659, 'sine', 2100, .012)],
  pressure: [neon(82, .55, .11, 55, 'triangle', 500, .035)],
  'conflict-launch': [neon(175, .42, .09, 440, 'triangle', 1700, .02)],
  'conflict-impact': [neon(110, .48, .12, 55, 'triangle', 700, .045)],
  cleanup: [neon(247, .32, .065, 494, 'sine', 1900, .012)],
  'shield-half-charge': [neon(220, .42, .06, 440, 'sine', 1800, .008)],
  'shield-full-charge': [neon(220, .65, .08, 660, 'triangle', 2100, .012)],
  'shield-block': [neon(165, .48, .1, 110, 'triangle', 950, .035)],
  'active-defense': [neon(294, .42, .075, 587, 'sine', 2000, .012)],
  'final-push': [neon(147, .7, .115, 294, 'triangle', 1700, .035)],
  eliminated: [neon(330, .48, .08, 165, 'triangle', 1200, .02)],
  'results-win': [neon(262, .8, .09, 523, 'triangle', 2100, .012)],
  'results-lose': [neon(247, .7, .08, 123, 'triangle', 1100, .02)],
} satisfies Record<SfxPackEventId, readonly NeonVariant[]>;

const originalEvents = fromEntries(SFX_PACK_EVENT_IDS.map((event) => [event, [
  { renderer: 'original' as const },
  ...(['rotate', 'lock', 'line-clear'].includes(event) ? [{ renderer: 'original' as const }, { renderer: 'original' as const }] : []),
]])) as unknown as OriginalPack['events'];

export const SFX_PACKS = Object.freeze({
  'soft-toy': { id: 'soft-toy', label: 'Soft Toy', kind: 'buffered', events: softToyEvents },
  'neon-workshop': { id: 'neon-workshop', label: 'Neon Workshop', kind: 'procedural', events: neonEvents },
  original: { id: 'original', label: 'Original', kind: 'original', events: originalEvents },
  'quiet-mechanism': { id: 'quiet-mechanism', label: 'Тихая механика', kind: 'buffered', events: quietMechanismEvents },
}) satisfies Readonly<Record<SfxPresetId, SfxPack>>;
export const SFX_PACK_OPTIONS = SFX_PRESET_IDS.map((id) => ({ id, label: SFX_PACKS[id].label }));

export const SOFT_TOY_SFX_SOURCE = Object.freeze({
  title: 'Bub Block Sound Effects', author: 'roppychop / Roppy Chop Studios',
  source: 'https://opengameart.org/content/bub-block-sound-effects', license: 'CC0 1.0 Universal',
  derivedFiles: SOFT_TOY_ASSET_IDS.map((id) => `${id}.wav`),
});

const softToyUrls: Readonly<Record<SoftToyAssetId, string>> = { pickup: pickupUrl, open: openUrl, close: closeUrl, drop1: drop1Url, drop2: drop2Url, drop3: drop3Url, drop4: drop4Url, drop5: drop5Url };
const quietMechanismUrls: Readonly<Record<QuietMechanismAssetId, string>> = {
  'quiet-rotate-1': quietRotate1Url, 'quiet-rotate-2': quietRotate2Url, 'quiet-rotate-3': quietRotate3Url,
  'quiet-lock-1': quietLock1Url, 'quiet-lock-2': quietLock2Url, 'quiet-lock-3': quietLock3Url,
};

export function isSfxPresetId(value: unknown): value is SfxPresetId {
  return typeof value === 'string' && (SFX_PRESET_IDS as readonly string[]).includes(value);
}

export function validateSfxPack(pack: SfxPack): boolean {
  return SFX_PACK_EVENT_IDS.every((event) => Array.isArray(pack.events[event]) && pack.events[event].length > 0)
    && ['rotate', 'lock', 'line-clear'].every((event) => pack.events[event as SfxPackEventId].length >= 3);
}

export async function createSoftToySfxLibrary(context: AudioContext): Promise<Readonly<Record<SoftToyAssetId, AudioBuffer>>> {
  const entries = await Promise.all(SOFT_TOY_ASSET_IDS.map(async (id) => {
    const response = await fetch(softToyUrls[id]);
    if (!response.ok) throw new Error(`Unable to load Soft Toy SFX: ${id} (${response.status})`);
    return [id, await context.decodeAudioData(await response.arrayBuffer())] as const;
  }));
  return fromEntries(entries) as Readonly<Record<SoftToyAssetId, AudioBuffer>>;
}

export async function createQuietMechanismSfxLibrary(context: AudioContext): Promise<Readonly<Record<QuietMechanismAssetId, AudioBuffer>>> {
  const entries = await Promise.all(QUIET_MECHANISM_ASSET_IDS.map(async (id) => {
    const response = await fetch(quietMechanismUrls[id]);
    if (!response.ok) throw new Error(`Unable to load Quiet Mechanism SFX: ${id} (${response.status})`);
    return [id, await context.decodeAudioData(await response.arrayBuffer())] as const;
  }));
  return fromEntries(entries) as Readonly<Record<QuietMechanismAssetId, AudioBuffer>>;
}
