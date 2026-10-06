export const DEFAULT_PLAYER_NAMES = ['Игрок 1', 'Игрок 2', 'Игрок 3', 'Игрок 4'] as const;
export const PLAYER_NAME_STORAGE_KEY = 'bricks-war:player-names:v1';

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizePlayerName(value: string, index: number): string {
  const fallback = DEFAULT_PLAYER_NAMES[index] ?? DEFAULT_PLAYER_NAMES[0];
  return value.trim().replace(/\s+/g, ' ').slice(0, 18).trim() || fallback;
}

export function loadPlayerNames(storage: ReadStorage | null = defaultStorage()): string[] {
  if (!storage) return [...DEFAULT_PLAYER_NAMES];
  try {
    const parsed = JSON.parse(storage.getItem(PLAYER_NAME_STORAGE_KEY) ?? 'null') as unknown;
    if (!Array.isArray(parsed) || parsed.length !== DEFAULT_PLAYER_NAMES.length) return [...DEFAULT_PLAYER_NAMES];
    return parsed.map((value, index) => typeof value === 'string' ? normalizePlayerName(value, index) : DEFAULT_PLAYER_NAMES[index]!);
  } catch {
    return [...DEFAULT_PLAYER_NAMES];
  }
}

export function savePlayerNames(names: readonly string[], storage: WriteStorage | null = defaultStorage()): void {
  if (!storage || names.length !== DEFAULT_PLAYER_NAMES.length) return;
  try {
    storage.setItem(PLAYER_NAME_STORAGE_KEY, JSON.stringify(names.map(normalizePlayerName)));
  } catch {
    // Storage can be unavailable in privacy modes; the selected name still works this match.
  }
}
