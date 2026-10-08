export type MatchMusicId = 'living-construction' | 'brick-funk' | 'clockwork-carousel' | 'spring-rush';

export interface RecordedMusicTrack {
  id: MatchMusicId;
  title: string;
  url: string;
}

export const MENU_MUSIC_URL = './audio/music/menu-workshop.mp3';
export const MATCH_MUSIC: readonly RecordedMusicTrack[] = [
  { id: 'living-construction', title: 'Живой конструктор', url: './audio/music/living-construction.mp3' },
  { id: 'brick-funk', title: 'Кирпичный грув', url: './audio/music/brick-funk.mp3' },
  { id: 'clockwork-carousel', title: 'Карусель ходов', url: './audio/music/clockwork-carousel.mp3' },
  { id: 'spring-rush', title: 'Пружинный рывок', url: './audio/music/spring-rush.mp3' },
];

export const MUSIC_RAMP_SECONDS = 180;
export const MUSIC_RAMP_START_BPM = 110;
export const MUSIC_RAMP_END_BPM = 145;
// The masters stay at 145 BPM after 180 seconds. A 16-bar plateau segment
// repeats after that point, avoiding the preview-only tail fade.
export const MUSIC_PLATEAU_LOOP_END_SECONDS = 180 + (64 * 60 / MUSIC_RAMP_END_BPM);

export function matchMusicForSeed(seed: number): RecordedMusicTrack {
  const stableSeed = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
  return MATCH_MUSIC[stableSeed % MATCH_MUSIC.length]!;
}

export function matchMusicOffset(elapsedMs: number): number {
  const elapsedSeconds = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs / 1000 : 0);
  if (elapsedSeconds < MUSIC_RAMP_SECONDS) return elapsedSeconds;
  const loopDuration = MUSIC_PLATEAU_LOOP_END_SECONDS - MUSIC_RAMP_SECONDS;
  return MUSIC_RAMP_SECONDS + ((elapsedSeconds - MUSIC_RAMP_SECONDS) % loopDuration);
}
