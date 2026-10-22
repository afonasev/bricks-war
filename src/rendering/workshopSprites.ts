import type * as Phaser from 'phaser/dist/phaser.esm.js';
import type { TileStyle } from '../domain/types';
import classicUrl from '../assets/workshop/tiles-f5.webp';
import constructionUrl from '../assets/workshop/construction-bricks-f6.webp';
import pixelUrl from '../assets/workshop/pixel-adventure-f6.webp';
import stoneUrl from '../assets/workshop/stone-fortress-f6.webp';
import marmaladeUrl from '../assets/workshop/marmalade-f6.webp';
import forestUrl from '../assets/workshop/forest-mosaic-f6.webp';
import type { StyledTileOptions } from './tileRenderer';
import frames from '../assets/workshop/tiles-f5.json';

export const WORKSHOP_TILE_TEXTURE = 'workshop-tiles-f5';
export const WORKSHOP_THEME_TEXTURES: Record<TileStyle, {key:string;url:string}> = {
  classic: {key:WORKSHOP_TILE_TEXTURE,url:classicUrl},
  'construction-bricks': {key:'workshop-tiles-construction-f6',url:constructionUrl},
  'pixel-adventure': {key:'workshop-tiles-pixel-f6',url:pixelUrl},
  'stone-fortress': {key:'workshop-tiles-stone-f6',url:stoneUrl},
  marmalade: {key:'workshop-tiles-marmalade-f6',url:marmaladeUrl},
  'forest-mosaic': {key:'workshop-tiles-forest-f6',url:forestUrl},
  'sea-crystals': {key:'workshop-tiles-legacy-classic',url:classicUrl},
};
const frameForKind: Record<string, number> = { Z: 0, L: 1, O: 2, S: 3, I: 4, J: 5, T: 6 };

/** Scene-owned pools follow each Graphics layer's invalidation, mask and lifetime. */
export class WorkshopSprites {
  private layers = new Map<Phaser.GameObjects.Graphics, { images: Phaser.GameObjects.Image[]; used: number }>();
  constructor(private scene: Phaser.Scene) {
    for (const {key} of Object.values(WORKSHOP_THEME_TEXTURES)) {
      const texture = scene.textures.get(key);
      frames.forEach((frame, i) => {
        if (!texture.has(String(i))) texture.add(String(i), 0, frame.x, frame.y, frame.width, frame.height);
      });
    }
  }
  draw(graphics: Phaser.GameObjects.Graphics, tile: StyledTileOptions): boolean {
    const frame = frameForKind[tile.kind];
    if (!tile.polished || frame === undefined) return false;
    const key = WORKSHOP_THEME_TEXTURES[tile.style].key;
    let layer = this.layers.get(graphics);
    if (!layer) { layer = { images: [], used: 0 }; this.layers.set(graphics, layer); }
    let image = layer.images[layer.used];
    if (!image) { image = this.scene.add.image(0, 0, WORKSHOP_TILE_TEXTURE).setOrigin(0); layer.images.push(image); }
    layer.used++;
    image.setTexture(key, String(frame)).setPosition(tile.x, tile.y)
      .setDisplaySize(tile.size, tile.size).setAlpha(tile.alpha).setVisible(true)
      // Static tiles sit over their board; dynamic tiles stay beneath heat/effect primitives.
      .setDepth(graphics.depth + (graphics.depth < 0 ? .01 : -.01));
    if (graphics.mask) image.setMask(graphics.mask); else image.clearMask();
    return true;
  }
  reset(graphics: Phaser.GameObjects.Graphics): void {
    const layer = this.layers.get(graphics);
    if (!layer) return;
    layer.images.forEach(image => image.setVisible(false));
    layer.used = 0;
  }
  remove(graphics: Phaser.GameObjects.Graphics): void {
    this.layers.get(graphics)?.images.forEach(image => image.destroy());
    this.layers.delete(graphics);
  }
  destroy(): void { for (const graphics of this.layers.keys()) this.remove(graphics); }
}
