export type GridDirection = 'previous' | 'next' | 'decrease' | 'increase';
export interface NavigationRect { left: number; top: number; right: number; bottom: number }
/** Move in the requested screen direction. Edges never wrap to another row. */
export function spatialIndex(rects: readonly NavigationRect[], index: number, direction: GridDirection): number {
    if (index < 0 || !rects[index]) return rects.length ? 0 : -1;
    const from = rects[index]!, vertical = direction === 'previous' || direction === 'next';
    const sign = direction === 'previous' || direction === 'decrease' ? -1 : 1;
    const center = (r: NavigationRect) => vertical ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2;
    const cross = (r: NavigationRect) => vertical ? (r.left + r.right) / 2 : (r.top + r.bottom) / 2;
    let best = index, score = Infinity;
    rects.forEach((r, i) => {
        if (i === index || r.right <= r.left || r.bottom <= r.top) return;
        const forward = (center(r) - center(from)) * sign;
        const overlap = vertical ? Math.min(r.right, from.right) - Math.max(r.left, from.left) : Math.min(r.bottom, from.bottom) - Math.max(r.top, from.top);
        if (forward <= 1 || overlap <= 1) return;
        const candidate = forward + Math.abs(cross(r) - cross(from)) * 2;
        if (candidate < score) { best = i; score = candidate; }
    });
    return best;
}
export function spatialElementIndex(elements: readonly HTMLElement[], index: number, direction: GridDirection): number {
    return spatialIndex(elements.map(e => e.getBoundingClientRect()), index, direction);
}
