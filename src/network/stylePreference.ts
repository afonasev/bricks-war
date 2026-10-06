import { isTileStyle } from '../domain/tileStyles';
import type { TileStyleSelection } from '../domain/types';

export const NETWORK_STYLE_KEY = 'bricks-war:network-tile-style:v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
function browserStorage(): Store | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
export function loadNetworkStyle(storage: Pick<Store, 'getItem'> | null = browserStorage()): TileStyleSelection {
  try {
    const value = storage?.getItem(NETWORK_STYLE_KEY);
    return value && isTileStyle(value) ? value : 'random';
  } catch { return 'random'; }
}
export function saveNetworkStyle(value: string, storage: Pick<Store, 'setItem'> | null = browserStorage()): void {
  if (value !== 'random' && !isTileStyle(value)) return;
  try { storage?.setItem(NETWORK_STYLE_KEY, value); } catch { /* Current room still works without storage. */ }
}
