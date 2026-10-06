export type AudioPriority = 'tactile' | 'reward' | 'critical';
export type MusicDirectionId = 'neon-workshop' | 'toybox-tactics' | 'arcade-skyline' | 'glass-gravity' | 'brickbeat';
export type SfxDirectionId = 'soft-toy' | 'construction' | 'arcade' | 'glassy-future';
export type AudioPreviewCategory = 'tactile' | 'rewards' | 'threats' | 'defenses' | 'gameplay-music' | 'menu-music';

export interface MusicDirection {
  id: MusicDirectionId;
  label: string;
  menuLabel: string;
  matchIntro: readonly number[];
  melody: readonly number[];
  menuMelody: readonly number[];
  chords: readonly (readonly number[])[];
  lead: OscillatorType;
  accent: OscillatorType;
  transpose: number;
}

export interface SfxDirection {
  id: SfxDirectionId;
  label: string;
  lead: OscillatorType;
  accent: OscillatorType;
  pitchOffset: number;
  brightness: number;
  body: number;
  contact: number;
}

export const MUSIC_DIRECTIONS: readonly MusicDirection[] = [
  { id: 'neon-workshop', label: 'Neon Workshop', menuLabel: 'Мягкий неон мастерской', matchIntro: [52, 59, 64, 67, 71, 76], melody: [72, 71, 67, 64, 69, 72, 76, 74, 62, 65, 69, 67, 64, 69, 71, 76], menuMelody: [64, 67, 71, 69, 62, 65, 69, 67, 60, 64, 67, 65, 62, 64, 69, 67], chords: [[40, 47, 52], [38, 45, 52], [43, 50, 55], [36, 43, 52]], lead: 'triangle', accent: 'sine', transpose: 0 },
  { id: 'toybox-tactics', label: 'Toybox Tactics', menuLabel: 'Тёплая шкатулка', matchIntro: [60, 67, 72, 76, 79, 84], melody: [79, 74, 76, 81, 77, 74, 72, 76, 71, 74, 79, 74, 72, 76, 81, 79], menuMelody: [72, 76, 79, 76, 71, 74, 77, 74, 69, 72, 76, 72, 71, 74, 77, 79], chords: [[48, 55, 60], [45, 52, 60], [50, 57, 62], [43, 50, 59]], lead: 'sine', accent: 'triangle', transpose: 0 },
  { id: 'arcade-skyline', label: 'Arcade Skyline', menuLabel: 'Аркадный горизонт', matchIntro: [57, 64, 69, 76, 81, 83], melody: [83, 76, 81, 84, 79, 74, 78, 83, 76, 81, 84, 79, 74, 78, 83, 86], menuMelody: [76, 79, 83, 79, 74, 78, 81, 78, 72, 76, 79, 76, 74, 78, 81, 83], chords: [[45, 52, 57], [43, 50, 59], [48, 55, 60], [41, 48, 57]], lead: 'square', accent: 'triangle', transpose: 0 },
  { id: 'glass-gravity', label: 'Glass & Gravity', menuLabel: 'Стекло и гравитация', matchIntro: [64, 71, 76, 81, 84, 88], melody: [88, 81, 84, 86, 83, 79, 84, 81, 77, 81, 86, 83, 76, 81, 84, 88], menuMelody: [81, 84, 88, 84, 79, 83, 86, 83, 76, 79, 83, 79, 77, 81, 84, 86], chords: [[52, 59, 64], [48, 55, 64], [50, 57, 62], [45, 52, 60]], lead: 'sine', accent: 'sine', transpose: 0 },
  { id: 'brickbeat', label: 'Brickbeat', menuLabel: 'Ритм кирпичей', matchIntro: [52, 55, 59, 64, 67, 71], melody: [64, 71, 69, 72, 67, 64, 66, 71, 62, 66, 71, 66, 64, 67, 72, 69], menuMelody: [64, 67, 71, 67, 62, 66, 69, 66, 60, 64, 67, 64, 62, 66, 69, 71], chords: [[40, 47, 52], [38, 45, 54], [43, 50, 55], [36, 43, 52]], lead: 'sawtooth', accent: 'triangle', transpose: 0 },
] as const;

export const SFX_DIRECTIONS: readonly SfxDirection[] = [
  { id: 'soft-toy', label: 'Soft Toy', lead: 'sine', accent: 'triangle', pitchOffset: -7, brightness: 0.48, body: 190, contact: 760 },
  { id: 'construction', label: 'Construction', lead: 'triangle', accent: 'triangle', pitchOffset: -10, brightness: 0.4, body: 125, contact: 540 },
  { id: 'arcade', label: 'Arcade', lead: 'triangle', accent: 'sine', pitchOffset: -4, brightness: 0.56, body: 220, contact: 900 },
  { id: 'glassy-future', label: 'Glassy Future', lead: 'sine', accent: 'triangle', pitchOffset: -2, brightness: 0.68, body: 260, contact: 1100 },
] as const;

export const AUDIO_EVENT_PRIORITY: Readonly<Record<string, AudioPriority>> = {
  rotate: 'tactile', lock: 'tactile', 'line-clear': 'reward', 'clear-impact': 'reward', 'level-up': 'reward', countdown: 'reward', 'round-start': 'reward',
  'anomaly-spawn': 'critical', pressure: 'critical', 'conflict-launch': 'critical', 'conflict-impact': 'critical', cleanup: 'reward',
  'shield-half-charge': 'reward', 'shield-full-charge': 'reward', 'shield-block': 'critical', 'active-defense': 'critical', 'final-push': 'critical', eliminated: 'critical', results: 'reward',
};

export const CRITICAL_MUSIC_DUCK_GAIN = 0.12;
export const CRITICAL_MUSIC_DUCK_SECONDS = 0.28;

export function musicGainForPriority(priority: AudioPriority | undefined, normalGain: number): number {
  return priority === 'critical' ? Math.min(normalGain, CRITICAL_MUSIC_DUCK_GAIN) : normalGain;
}

export function musicDirection(id: MusicDirectionId): MusicDirection {
  return MUSIC_DIRECTIONS.find((direction) => direction.id === id) ?? MUSIC_DIRECTIONS[0]!;
}

export function sfxDirection(id: SfxDirectionId): SfxDirection {
  return SFX_DIRECTIONS.find((direction) => direction.id === id) ?? SFX_DIRECTIONS[0]!;
}

export function variationIndex(event: string, count: number, occurrence: number): number {
  if (count <= 1) return 0;
  let hash = 0;
  for (const char of event) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return (hash + occurrence) % count;
}
