import { DEFAULT_TILE_STYLE, DEFAULT_TILE_STYLE_SELECTION, TILE_STYLE_IDS } from '../domain/tileStyles';
import type { ParticipantConfig, TileStyle } from '../domain/types';
import { deriveSeed, SeededRandom } from './random';

function shuffledStyles(styles: readonly TileStyle[], random: SeededRandom): TileStyle[] {
  const result = [...styles];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = random.int(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex] as TileStyle, result[index] as TileStyle];
  }
  return result;
}

export function resolveParticipantTileStyles(
  configs: readonly ParticipantConfig[],
  seed: number,
): ReadonlyMap<string, TileStyle> {
  const manual = new Set<TileStyle>();
  for (const config of configs) {
    const selection = config.tileStyle ?? DEFAULT_TILE_STYLE_SELECTION;
    if (selection !== 'random') manual.add(selection);
  }

  const random = new SeededRandom(deriveSeed(seed, 'participant-tile-styles'));
  let pool = shuffledStyles(TILE_STYLE_IDS.filter((style) => !manual.has(style)), random);
  const resolved = new Map<string, TileStyle>();

  for (const config of configs) {
    const selection = config.tileStyle ?? DEFAULT_TILE_STYLE_SELECTION;
    if (selection !== 'random') {
      resolved.set(config.id, selection);
      continue;
    }
    if (pool.length === 0) pool = shuffledStyles(TILE_STYLE_IDS, random);
    resolved.set(config.id, pool.shift() ?? DEFAULT_TILE_STYLE);
  }
  return resolved;
}
