import { describe, it, expect, vi } from 'vitest';
import { TILE_STYLES } from '../src/domain/tileStyles';
import { WorkshopSprites, WORKSHOP_THEME_TEXTURES } from '../src/rendering/workshopSprites';
import type { StyledTileOptions } from '../src/rendering/tileRenderer';

function harness() {
  const images: any[] = [];
  const scene = { textures: { get: () => ({ has: () => false, add: vi.fn() }) }, add: { image: () => {
    const image: any = { visible: false, destroyed: false };
    for (const name of ['setOrigin','setTexture','setPosition','setDisplaySize','setAlpha','setDepth','setMask']) {
      image[name] = vi.fn((...args: unknown[]) => { image[name + 'Value'] = args; return image; });
    }
    image.setVisible = (visible: boolean) => { image.visible = visible; return image; };
    image.clearMask = () => { image.setMaskValue = []; return image; };
    image.destroy = () => { image.destroyed = true; };
    images.push(image); return image;
  } } };
  return { pool: new WorkshopSprites(scene as never), images };
}
const tile: StyledTileOptions = { style:'classic', kind:'L', state:'settled', polished:true, x:10, y:20, size:35, color:0xff8800, alpha:1 };
describe('workshop sprite lifecycle', () => {
  it('keeps hazards and non-study boards on the existing renderer', () => {
    const { pool, images } = harness();
    for (const override of [{ polished:false }, { kind:'garbage' as const }, { kind:'anomaly' as const }])
      expect(pool.draw({depth:0} as never, {...tile,...override})).toBe(false);
    expect(images).toHaveLength(0);
  });
  it('selects a distinct material atlas for every theme without changing color frames', () => {
    const { pool, images } = harness(), g = {depth:0};
    const keys = new Set<string>();
    for (const style of TILE_STYLES) {
      pool.reset(g as never);
      expect(pool.draw(g as never,{...tile,style:style.id})).toBe(true);
      expect(images[0].setTextureValue).toEqual([WORKSHOP_THEME_TEXTURES[style.id].key,'1']);
      keys.add(images[0].setTextureValue[0]);
    }
    expect(keys.size).toBe(7);expect(images).toHaveLength(1);
  });
  it('reuses hidden sprites after clear, preserving exact size and ghost alpha', () => {
    const { pool, images } = harness(), g = {depth:0};
    pool.draw(g as never,tile);pool.draw(g as never,{...tile,x:45});
    pool.reset(g as never);expect(images.every(i=>!i.visible)).toBe(true);
    pool.draw(g as never,{...tile,state:'ghost',alpha:.28});
    expect(images).toHaveLength(2);expect(images[0].visible).toBe(true);expect(images[1].visible).toBe(false);
    expect(images[0].setPositionValue).toEqual([10,20]);expect(images[0].setDisplaySizeValue).toEqual([35,35]);
    expect(images[0].setAlphaValue).toEqual([.28]);
    pool.destroy();expect(images.every(i=>i.destroyed)).toBe(true);
  });
  it('inherits shield clipping and leaves dynamic effects above tiles', () => {
    const { pool, images } = harness(), mask = {}, g: any = {depth:1, mask};
    pool.draw(g,tile);expect(images[0].setMaskValue).toEqual([mask]);expect(images[0].setDepthValue[0]).toBeLessThan(1);
    pool.reset(g);g.mask=null;pool.draw(g,tile);expect(images[0].setMaskValue).toEqual([]);
    pool.remove(g);expect(images[0].destroyed).toBe(true);
  });
});
