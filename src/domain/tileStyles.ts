import type { TileStyle, TileStyleSelection } from './types';

export interface TileStyleDefinition {
  id: TileStyle;
  label: string;
  shortLabel: string;
}

export const TILE_STYLES: readonly TileStyleDefinition[] = [
  { id: 'classic', label: 'Классика', shortLabel: 'Классика' },
  { id: 'construction-bricks', label: 'Конструктор', shortLabel: 'Конструктор' },
  { id: 'pixel-adventure', label: 'Пиксельное приключение', shortLabel: 'Пиксели' },
  { id: 'stone-fortress', label: 'Каменная крепость', shortLabel: 'Крепость' },
  { id: 'marmalade', label: 'Мармелад', shortLabel: 'Мармелад' },
  { id: 'forest-mosaic', label: 'Лесная мозаика', shortLabel: 'Лес' },
  { id: 'sea-crystals', label: 'Морские кристаллы', shortLabel: 'Кристаллы' },
] as const;

export const TILE_STYLE_IDS = TILE_STYLES.map(({ id }) => id) as readonly TileStyle[];
export const DEFAULT_TILE_STYLE: TileStyle = 'classic';
export const DEFAULT_TILE_STYLE_SELECTION: TileStyleSelection = 'random';

export function isTileStyle(value: string): value is TileStyle {
  return TILE_STYLE_IDS.includes(value as TileStyle);
}

export function tileStyleLabel(style: TileStyleSelection): string {
  if (style === 'random') return 'Случайный';
  return TILE_STYLES.find(({ id }) => id === style)?.label ?? 'Классика';
}
