import { describe, expect, it } from 'vitest';
import { usesWorkshopStudy } from '../src/rendering/workshopStudy';

describe('single-board material review isolation', () => {
  it('enables only the desktop local solo field', () => {
    expect(usesWorkshopStudy(false,false,1)).toBe(true);
    for(const count of [2,3,4,8]) expect(usesWorkshopStudy(false,false,count)).toBe(false);
    expect(usesWorkshopStudy(true,false,1)).toBe(false);
    expect(usesWorkshopStudy(false,true,1)).toBe(false);
  });
});

import { workshopPanelColor } from '../src/rendering/workshopStudy';
describe('wooden player panel identity', () => {
  it('keeps four distinct stable slots, clamps out-of-range slots', () => {
    const colors = [0,1,2,3].map(i=>workshopPanelColor(i,'free-for-all',true));
    expect(new Set(colors).size).toBe(4);
    expect(workshopPanelColor(-1,'free-for-all',true)).toBe(colors[0]);
    expect(workshopPanelColor(8,'free-for-all',true)).toBe(colors[3]);
  });
  it('honors explicit team IDs and preserves team fallback and elimination', () => {
    expect(workshopPanelColor(0,'teams',true,'team-2')).toBe(workshopPanelColor(3,'teams',true));
    expect(workshopPanelColor(3,'teams',true,'team-1')).toBe(workshopPanelColor(0,'teams',true));
    expect(workshopPanelColor(0,'teams',true)).not.toBe(workshopPanelColor(3,'teams',true));
    expect(workshopPanelColor(0,'free-for-all',false)).toBe(workshopPanelColor(3,'teams',false));
  });
});

import { chooseArenaLayout } from '../src/rendering/arenaLayout';
describe('wood housing layout clearance', () => {
  it('reserves rails around every local desktop board at wide and short viewports', () => {
    for (const [width,height] of [[1440,800],[1280,360],[900,700]]) {
      for (const count of [2,3,4]) {
        const layout=chooseArenaLayout(width!,height!,count,16,52,18);
        expect((layout.slotWidth-layout.cardWidth)/2).toBeGreaterThanOrEqual(18);
        expect((layout.slotHeight-layout.cardHeight)/2).toBeGreaterThanOrEqual(18);
        expect(layout.cardWidth).toBe(layout.cellSize*10+4);
        expect(layout.cardHeight).toBe(layout.cellSize*20+56);
      }
    }
  });
});

it('tightens horizontal panel clearance without losing bottom-plank space',()=>{
  const before=chooseArenaLayout(1440,800,4,16,52,32);
  const after=chooseArenaLayout(1440,800,4,16,52,32,22);
  expect(after.cellSize).toBeGreaterThan(before.cellSize);
  expect((after.slotWidth-after.cardWidth)/2).toBeGreaterThanOrEqual(22);
  expect((after.slotHeight-after.cardHeight)/2).toBeGreaterThanOrEqual(32);
});
