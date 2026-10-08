import { describe, expect, it } from 'vitest';
import { MATCH_MUSIC, MENU_MUSIC_URL, MUSIC_PLATEAU_LOOP_END_SECONDS, matchMusicForSeed, matchMusicOffset } from '../src/audio/musicCatalog';

describe('recorded music catalog', () => {
  it('contains the approved distinct menu and four match tracks', () => {
    expect(MATCH_MUSIC.map((track) => track.title)).toEqual([
      'Живой конструктор', 'Кирпичный грув', 'Карусель ходов', 'Пружинный рывок',
    ]);
    expect(new Set(MATCH_MUSIC.map((track) => track.url)).size).toBe(4);
    expect(MENU_MUSIC_URL).toContain('menu-workshop.mp3');
  });

  it('selects the same match theme for the same seed', () => {
    expect(matchMusicForSeed(8123)).toEqual(matchMusicForSeed(8123));
    expect(MATCH_MUSIC.map((_, index) => matchMusicForSeed(index).id)).toEqual(MATCH_MUSIC.map((track) => track.id));
  });

  it('ramps to 180 seconds and loops only the steady 145 BPM plateau', () => {
    expect(matchMusicOffset(0)).toBe(0);
    expect(matchMusicOffset(179_000)).toBe(179);
    expect(matchMusicOffset(180_000)).toBe(180);
    expect(matchMusicOffset(180_000 + (MUSIC_PLATEAU_LOOP_END_SECONDS - 180) * 1_000)).toBe(180);
    expect(matchMusicOffset(240_000)).toBeGreaterThanOrEqual(180);
    expect(matchMusicOffset(240_000)).toBeLessThan(MUSIC_PLATEAU_LOOP_END_SECONDS);
  });
});
