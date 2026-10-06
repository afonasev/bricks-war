/** One shared impact signature; line count changes only its gain. */
export const CLEAR_IMPACT_GAINS = [0, 0.12, 0.25, 0.48, 0.86] as const;

export function impactGainForLines(lines: number): number {
  return CLEAR_IMPACT_GAINS[Math.max(1, Math.min(4, Math.floor(lines))) as 1 | 2 | 3 | 4];
}

function randomStream(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x80000000 - 1;
  };
}

export function impactSamples(sampleRate: number): Float32Array {
  const samples = new Float32Array(Math.floor(sampleRate * 0.86));
  const random = randomStream(12037);
  let low = 0;
  let veryLow = 0;
  let phase = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    const noise = random();
    low += (noise - low) * 0.11;
    veryLow += (low - veryLow) * 0.004;
    phase += 2 * Math.PI * Math.max(46, 95 - 48 * t) / sampleRate;
    const rumble = (low - veryLow) * 1.8 * Math.exp(-t * 6);
    const thud = Math.sin(phase) * 0.52 * Math.exp(-t * 19);
    const crackle = [0, 0.025, 0.052, 0.083].reduce((sum, moment, index) => {
      const offset = t - moment;
      return offset >= 0 && offset < 0.027 ? sum + noise * [0.27, 0.18, 0.13, 0.08][index]! * Math.exp(-offset * 180) : sum;
    }, 0);
    const fade = t < 0.58 ? 1 : Math.cos(Math.min(1, (t - 0.58) / 0.28) * Math.PI / 2) ** 2;
    samples[i] = Math.max(-1, Math.min(1, (rumble + thud + crackle) * Math.min(1, t / 0.002) * fade));
  }
  return samples;
}

export function fireSamples(sampleRate: number): Float32Array {
  const samples = new Float32Array(Math.floor(sampleRate * 1.72));
  const random = randomStream(38091);
  const crackles = new Float32Array(samples.length);
  const addCrackle = (moment: number, strength: number, frequency: number, decay: number) => {
    const start = Math.floor(moment * sampleRate);
    const length = Math.min(Math.floor(decay * sampleRate * 5), samples.length - start);
    let snapLow = 0;
    let bodyLow = 0;
    for (let offset = 0; offset < length; offset += 1) {
      const age = offset / sampleRate;
      const noise = random();
      snapLow += (noise - snapLow) * 0.12;
      bodyLow += (snapLow - bodyLow) * 0.035;
      const snap = (noise - snapLow) * Math.exp(-age / 0.003);
      const body = (snapLow - bodyLow) * Math.exp(-age / decay);
      const ring = Math.sin(2 * Math.PI * frequency * age * (1 - 0.22 * age / decay)) * Math.exp(-age / (decay * 0.55));
      crackles[start + offset] = crackles[start + offset]! + strength * Math.min(1, age / 0.00035) * (snap * 0.04 + body * 0.9 + ring * 0.32);
    }
  };
  for (let moment = 0.04; moment < 1.06;) {
    moment += 0.065 + (random() + 1) * 0.047;
    const strength = 0.29 + (random() + 1) * 0.15;
    addCrackle(moment, strength, 320 + (random() + 1) * 310, 0.011 + (random() + 1) * 0.008);
    if (random() > 0.17) {
      addCrackle(moment + 0.007 + (random() + 1) * 0.009, strength * (0.22 + (random() + 1) * 0.2),
        650 + (random() + 1) * 420, 0.004 + (random() + 1) * 0.004);
    }
  }
  let low = 0;
  let mid = 0;
  let sub = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    const noise = random();
    low += (noise - low) * 0.014;
    mid += (noise - mid) * 0.075;
    sub += (low - sub) * 0.0005;
    const breath = (low - sub) * 0.82 + (mid - low) * 0.16;
    const swell = 0.78 + 0.13 * Math.sin(2 * Math.PI * 5.3 * t) + 0.09 * Math.sin(2 * Math.PI * 8.7 * t + 1.2);
    const attack = Math.sin(Math.min(1, t / 0.075) * Math.PI / 2) ** 2;
    const fade = t < 0.98 ? 1 : Math.cos(Math.min(1, (t - 0.98) / 0.74) * Math.PI / 2) ** 2;
    samples[i] = Math.max(-1, Math.min(1, (breath * swell + crackles[i]!) * attack * fade * 1.8));
  }
  return samples;
}

export function audioBufferFromSamples(context: AudioContext, samples: Float32Array): AudioBuffer {
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}
