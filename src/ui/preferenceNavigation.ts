import { spatialElementIndex } from './spatialNavigation';

/** Uneven settings stacks still offer a horizontal path into the other column. */
export function preferenceHorizontalIndex(elements: readonly HTMLElement[], index: number, direction: 'decrease' | 'increase'): number {
  const fallback = () => spatialElementIndex(elements, index, direction);
  const column = elements[index]?.closest<HTMLElement>('.settings-columns, .pause-preferences-column');
  if (!column?.parentElement) return fallback();
  const columns = Array.from(column.parentElement.querySelectorAll<HTMLElement>(':scope > .settings-columns, :scope > .pause-preferences-column'))
    .filter(element => element.getBoundingClientRect().width > 1);
  if (columns.length !== 2) return fallback();
  const source = column.getBoundingClientRect();
  const target = columns.find(element => {
    if (element === column) return false;
    const rect = element.getBoundingClientRect();
    return direction === 'increase' ? rect.left >= source.right - 1 : rect.right <= source.left + 1;
  });
  if (!target) return fallback();
  const from = elements[index]!.getBoundingClientRect();
  const y = (from.top + from.bottom) / 2;
  let best = index, distance = Infinity;
  elements.forEach((element, candidate) => {
    if (!target.contains(element)) return;
    const rect = element.getBoundingClientRect();
    const next = Math.abs((rect.top + rect.bottom) / 2 - y);
    if (rect.width > 0 && rect.height > 0 && next < distance) { best = candidate; distance = next; }
  });
  return best;
}
