import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TILE_STYLE,
  DEFAULT_TILE_STYLE_SELECTION,
  isTileStyle,
  TILE_STYLES,
  tileStyleLabel,
} from '../src/domain/tileStyles';
import type { ParticipantConfig, TileStyle } from '../src/domain/types';
import { MatchEngine } from '../src/simulation/match';
import { resolveParticipantTileStyles } from '../src/simulation/tileStyles';

function configs(...styles: ParticipantConfig['tileStyle'][]): ParticipantConfig[] {
  return styles.map((tileStyle, index) => ({
    id: `p${index + 1}`,
    label: `P${index + 1}`,
    controller: index === 0 ? 'human-1' : index === 1 ? 'human-2' : 'ai',
    difficulty: index >= 2 ? 'medium' : undefined,
    tileStyle,
  }));
}

describe('tile style catalog', () => {
  it('contains the seven bounded original styles and Russian labels', () => {
    expect(TILE_STYLES.map(({ id }) => id)).toEqual([
      'classic', 'construction-bricks', 'pixel-adventure', 'stone-fortress', 'marmalade', 'forest-mosaic', 'sea-crystals',
    ]);
    expect(TILE_STYLES.every(({ label, shortLabel }) => label.length > 0 && shortLabel.length > 0)).toBe(true);
    expect(DEFAULT_TILE_STYLE).toBe('classic');
    expect(DEFAULT_TILE_STYLE_SELECTION).toBe('random');
    expect(tileStyleLabel('random')).toBe('Случайный');
    expect(tileStyleLabel('construction-bricks')).toBe('Конструктор');
    expect(isTileStyle('construction-bricks')).toBe(true);
    expect(isTileStyle('sea-crystals')).toBe(true);
    expect(isTileStyle('unknown')).toBe(false);
    // @ts-expect-error Unknown IDs must not type-check as a concrete style.
    const invalid: TileStyle = 'unknown';
    expect(invalid).toBe('unknown');
  });
});

describe('participant tile style resolution', () => {
  it('defaults missing selections to seeded Random in configuration and live state', () => {
    const engine = new MatchEngine(configs(undefined, undefined), 10);
    expect(engine.state.participants.map(({ config }) => config.tileStyle)).toEqual(['random', 'random']);
    expect(new Set(engine.state.participants.map(({ resolvedTileStyle }) => resolvedTileStyle)).size).toBe(2);
  });

  it('preserves deliberate manual duplicates', () => {
    const resolved = resolveParticipantTileStyles(configs('marmalade', 'marmalade'), 11);
    expect([...resolved.values()]).toEqual(['marmalade', 'marmalade']);
  });

  it('keeps saved Classic selections while making Construction independently selectable', () => {
    const resolved = resolveParticipantTileStyles(configs('classic', 'construction-bricks'), 12);
    expect([...resolved.values()]).toEqual(['classic', 'construction-bricks']);
  });

  it('reserves manual styles and assigns unique remaining styles to Random slots', () => {
    const participants = configs('classic', 'random', 'random', 'stone-fortress');
    const resolved = resolveParticipantTileStyles(participants, 42);
    const values = participants.map(({ id }) => resolved.get(id));
    expect(values[0]).toBe('classic');
    expect(values[3]).toBe('stone-fortress');
    expect(values[1]).not.toBe('classic');
    expect(values[1]).not.toBe('stone-fortress');
    expect(values[2]).not.toBe('classic');
    expect(values[2]).not.toBe('stone-fortress');
    expect(values[1]).not.toBe(values[2]);
  });

  it('is reproducible for the same seed and can vary for another seed', () => {
    const participants = configs('random', 'random', 'random', 'random');
    const first = [...resolveParticipantTileStyles(participants, 73).values()];
    expect([...resolveParticipantTileStyles(participants, 73).values()]).toEqual(first);
    expect([...resolveParticipantTileStyles(participants, 74).values()]).not.toEqual(first);
  });

  it('repeats only after the unreserved pool is exhausted', () => {
    const reserved: ParticipantConfig[] = [
      ...configs('classic', 'construction-bricks', 'pixel-adventure', 'stone-fortress', 'marmalade', 'forest-mosaic', 'sea-crystals'),
      { id: 'random-1', label: 'R1', controller: 'ai', difficulty: 'easy', tileStyle: 'random' },
      { id: 'random-2', label: 'R2', controller: 'ai', difficulty: 'easy', tileStyle: 'random' },
    ];
    const resolved = resolveParticipantTileStyles(reserved, 99);
    expect(resolved.get('random-1')).toBeDefined();
    expect(resolved.get('random-2')).toBeDefined();
  });
});
