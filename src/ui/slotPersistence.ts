export type SlotSelection = 'off' | 'human-1' | 'human-2' | 'ai-easy' | 'ai-medium' | 'ai-hard' | 'ai-expert';

export const DEFAULT_SLOT_SELECTIONS: readonly SlotSelection[] = ['human-1', 'human-2', 'ai-medium', 'off'];
export const SLOT_SELECTION_STORAGE_KEY = 'bricks-war:slot-selections:v1';

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

const VALID_SLOT_SELECTIONS = new Set<SlotSelection>([
  'off', 'human-1', 'human-2', 'ai-easy', 'ai-medium', 'ai-hard', 'ai-expert',
]);

function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSlotSelections(storage: ReadStorage | null = defaultStorage()): SlotSelection[] {
  if (!storage) return [...DEFAULT_SLOT_SELECTIONS];
  try {
    const parsed = JSON.parse(storage.getItem(SLOT_SELECTION_STORAGE_KEY) ?? 'null') as unknown;
    if (!Array.isArray(parsed) || parsed.length !== DEFAULT_SLOT_SELECTIONS.length) return [...DEFAULT_SLOT_SELECTIONS];
    return parsed.map((value, index) => (
      typeof value === 'string' && VALID_SLOT_SELECTIONS.has(value as SlotSelection)
        ? value as SlotSelection
        : DEFAULT_SLOT_SELECTIONS[index]!
    ));
  } catch {
    return [...DEFAULT_SLOT_SELECTIONS];
  }
}

export function saveSlotSelections(slots: readonly SlotSelection[], storage: WriteStorage | null = defaultStorage()): void {
  if (!storage || slots.length !== DEFAULT_SLOT_SELECTIONS.length) return;
  try {
    storage.setItem(SLOT_SELECTION_STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // Storage can be unavailable in privacy modes; match setup still works for the current page.
  }
}
