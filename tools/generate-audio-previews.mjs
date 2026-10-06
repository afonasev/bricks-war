import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rate = 44_100;
const output = resolve('audio-previews');
mkdirSync(output, { recursive: true });

const themes = {
  '01-neon-workshop': [52, 59, 64, 67, 71, 76, null, 72, 71, 67, 64, null, 69, 72, 76, 74],
  '02-toybox-tactics': [60, 67, 72, 76, 79, 84, null, 79, 74, 76, 81, null, 77, 74, 72, 76],
  '03-arcade-skyline': [57, 64, 69, 76, 81, 83, null, 83, 76, 81, 84, null, 79, 74, 78, 83],
  '04-glass-gravity': [64, 71, 76, 81, 84, 88, null, 88, 81, 84, 86, null, 83, 79, 84, 81],
  '05-brickbeat': [52, 55, 59, 64, 67, 71, null, 64, 71, 69, 72, null, 67, 64, 66, 71],
  '06-menu-theme': [64, 67, 71, 69, null, null, 60, 64, 67, 65, null, null],
};

const frequency = (midi) => 440 * (2 ** ((midi - 69) / 12));
const envelope = (position, length) => Math.min(1, position * 18) * Math.max(0, 1 - position / length) ** 2;
const clamp = (value) => Math.max(-1, Math.min(1, value));

function wav(name, seconds, render) {
  const samples = Math.floor(rate * seconds);
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) data.writeInt16LE(Math.round(clamp(render(index / rate)) * 32767), 44 + index * 2);
  writeFileSync(resolve(output, `${name}.wav`), data);
}

for (const [name, notes] of Object.entries(themes)) {
  wav(name, 9, (time) => {
    const step = Math.floor(time / 0.5) % notes.length;
    const local = time % 0.5;
    const note = notes[step];
    const phase = note === null ? 0 : 2 * Math.PI * frequency(note) * local;
    const lead = note === null ? 0 : Math.sin(phase) * envelope(local, 0.42) * 0.28;
    const octave = note === null ? 0 : Math.sin(phase / 2) * envelope(local, 0.36) * 0.08;
    const bassNote = note ?? notes.find((value) => value !== null) ?? 60;
    const bass = Math.sin(2 * Math.PI * frequency(bassNote - 24) * local) * envelope(local, 0.48) * 0.2;
    const kick = Math.floor(time * 2) % 2 === 0 ? Math.sin(2 * Math.PI * (82 - local * 36) * local) * envelope(local, 0.14) * 0.14 : 0;
    return lead + octave + bass + kick;
  });
}

function readMonoPcm16(file) {
  const data = readFileSync(resolve(file));
  const samples = new Float32Array((data.length - 44) / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = data.readInt16LE(44 + index * 2) / 32768;
  return samples;
}

const softToyClips = ['pickup', 'open', 'close', 'drop1', 'drop2', 'drop3', 'drop4', 'drop5']
  .map((name) => readMonoPcm16(`src/assets/audio/realistic-sfx/${name}.wav`));
wav('07-sfx-soft-toy', 7, (time) => {
  const slot = Math.floor(time / .7) % softToyClips.length;
  const localSample = Math.floor((time % .7) * rate);
  return (softToyClips[slot]?.[localSample] ?? 0) * .72;
});

const syntheticPacks = {
  '08-sfx-neon-workshop': { base: 165, end: .72, noise: .035, low: true },
  '09-sfx-original': { base: 330, end: 1.42, noise: .055, low: false },
};
for (const [name, profile] of Object.entries(syntheticPacks)) {
  wav(name, 7, (time) => {
    const slot = Math.floor(time / .7);
    const local = time % .7;
    const duration = slot % 4 === 3 ? .48 : .2;
    const pulse = envelope(local, duration);
    const sweep = profile.base * (1 + (profile.end - 1) * Math.min(1, local / duration));
    const body = Math.sin(2 * Math.PI * sweep * local) * pulse * (profile.low ? .3 : .22);
    const rounded = Math.sin(2 * Math.PI * sweep * 1.5 * local) * pulse * (profile.low ? .045 : .09);
    const impact = Math.sin((time * 12_989 + slot * 78_233) % 1) * profile.noise * Math.max(0, 1 - local * 10);
    return body + rounded + impact;
  });
}

console.log(`Generated ${Object.keys(themes).length + 3} WAV previews in ${output}`);
