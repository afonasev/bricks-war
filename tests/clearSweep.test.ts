import { describe, expect, it } from 'vitest';
import { clearSweepProgress, isClearCellVisible } from '../src/rendering/clearSweep';

describe('directional normal clear presentation', () => {
  const remaining = (p: number, calm = false) => Array.from({length: 10}, (_, x) => x).filter(x => isClearCellVisible(x, 10, p, calm));
  it('removes whole cells in order without changing the surviving cells', () => {
    expect(remaining(0)).toEqual([0,1,2,3,4,5,6,7,8,9]);
    expect(remaining(.5)).toEqual([5,6,7,8,9]);
    expect(remaining(.99)).toEqual([9]);
    expect(remaining(1)).toEqual([]);
    for (let n = 0; n <= 10; n++) expect(remaining(n/10)).toEqual(Array.from({length: 10-n}, (_, x) => x+n));
  });
  it('derives progress solely from active phase time, including pause/restore values', () => {
    expect(clearSweepProgress(180,180)).toBe(0);
    expect(clearSweepProgress(90,180)).toBe(.5);
    expect(clearSweepProgress(90,180)).toBe(.5);
    expect(clearSweepProgress(0,180)).toBe(1);
    expect(clearSweepProgress(-10,180)).toBe(1);
    expect(clearSweepProgress(200,180)).toBe(0);
    expect(clearSweepProgress(0,0)).toBe(1);
  });
  it('retains stationary cells throughout reduced-motion highlight', () => {
    for (const p of [0,.25,.5,1]) expect(remaining(p,true)).toEqual([0,1,2,3,4,5,6,7,8,9]);
  });
});
