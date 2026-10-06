export type FoleyKind = 'plastic-click' | 'wood-contact' | 'rubber-landing' | 'slide';
import { fromEntries } from '../runtime/compat';

export function createFoleyLibrary(context: AudioContext): Readonly<Record<FoleyKind, readonly AudioBuffer[]>> {
  const profiles: Readonly<Record<FoleyKind, readonly [number, number, number]>> = {
    'plastic-click': [0.075, 1500, 0.58],
    'wood-contact': [0.12, 760, 0.75],
    'rubber-landing': [0.18, 420, 0.92],
    slide: [0.16, 980, 0.82],
  };
  const entries = Object.entries(profiles).map(([kind, profile]) => [
    kind,
    [0, 1, 2].map((variant) => renderFoley(context, profile, variant)),
  ] as const);
  return fromEntries(entries) as unknown as Readonly<Record<FoleyKind, readonly AudioBuffer[]>>;
}

function renderFoley(context: AudioContext, [seconds, cutoff, decay]: readonly [number, number, number], variant: number): AudioBuffer {
  const size = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, size, context.sampleRate);
  const output = buffer.getChannelData(0);
  let low = 0;
  let seed = 0x6d2b79f5 + variant * 101;
  for (let index = 0; index < size; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = ((seed / 0xffffffff) * 2) - 1;
    low += (noise - low) * Math.min(0.94, cutoff / context.sampleRate);
    const time = index / context.sampleRate;
    const body = Math.sin(2 * Math.PI * (130 + variant * 24) * time) * Math.exp(-time / (seconds * decay));
    output[index] = (low * 0.68 + body * 0.32) * Math.exp(-time / (seconds * 0.62));
  }
  return buffer;
}
