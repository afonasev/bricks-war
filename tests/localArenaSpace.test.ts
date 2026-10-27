import { describe, expect, it } from 'vitest';
import { chooseLocalArenaLayout, localArenaDecoration } from '../src/rendering/arenaLayout';

describe('reduced local arena vertical reserve', () => {
  it.each([[1440, 960, 2, 42], [1280, 480, 4, 18]])('grows square cells at %ix%i with %i fields', (width, height, count, cell) => {
    const layout = chooseLocalArenaLayout(width, height, count);
    expect(layout.cellSize).toBe(cell);
    const cards = layout.participantCards!;
    const top = Math.min(...cards.map(c => c.y - 4));
    const bottom = height - Math.max(...cards.map(c => c.y + c.cardHeight + 12));
    expect(top).toBeGreaterThanOrEqual(24);
    expect(top).toBeLessThan(48);
    expect(bottom).toBeGreaterThanOrEqual(16);
    expect(bottom).toBeLessThan(40);
  });
});

describe('local decor and clock share actual free-side geometry', () => {
  it('uses the tighter side including pedestal overhang, even for asymmetric cards', () => {
    const decor = localArenaDecoration(1000, [{ x: 300, y: 32, cardWidth: 600, cardHeight: 600, cellSize: 30 }]);
    expect(decor.freeSide).toBe(92);
    expect(decor.sideWidth).toBe(60);
    expect(decor.visible).toBe(false);
    expect(decor.compactClock).toBe(true);
  });

  it.each([[1000, 180], [4000, 480]])('keeps the exact visibility threshold at width %i', (width, free) => {
    const make = (space: number) => [{ x: space + 8, y: 32, cardWidth: width - 2 * (space + 8), cardHeight: 600, cellSize: 20 }];
    expect(localArenaDecoration(width, make(free)).visible).toBe(true);
    expect(localArenaDecoration(width, make(free - 1)).visible).toBe(false);
    expect(localArenaDecoration(width, make(free)).sideWidth).toBe(free - 32);
  });

  it('keeps decor masks, housings and the compact clock strip disjoint across viewport/count changes', () => {
    for (const width of [800, 960, 1280, 1440, 1920, 3840]) for (const height of [400, 480, 720, 960, 1080, 2160]) for (const count of [1, 2, 3, 4]) {
      const header = count === 1 ? 80 : 52;
      const layout = chooseLocalArenaLayout(width, height, count, header);
      const cards = layout.participantCards!;
      const decor = localArenaDecoration(width, cards);
      for (const card of cards) {
        expect(card.x - 8 - decor.sideWidth).toBeGreaterThanOrEqual(32 - 1e-9);
        expect(width - decor.sideWidth - card.x - card.cardWidth - 8).toBeGreaterThanOrEqual(32 - 1e-9);
        expect(card.y - 4).toBeGreaterThanOrEqual(24);
        expect(card.y + card.cardHeight + 12).toBeLessThanOrEqual(height);
        // Compact plaque is at most 24px high, above the housing.
        if (decor.compactClock) expect(card.y - 4).toBeGreaterThanOrEqual(24);
      }
      expect(decor.artWidth).toBeLessThanOrEqual(width * 2 / 3);
    }
  });
});


describe('local pedestal overhang is reserved once', () => {
  it.each([[1440,960,29,42],[1920,1080,41,48],[1280,720,25,30]])('grows four width-limited fields without shrinking two at %ix%i', (width,height,fourCell,twoCell) => {
    const four=chooseLocalArenaLayout(width,height,4);
    expect(four.cellSize).toBe(fourCell);
    expect(chooseLocalArenaLayout(width,height,2).cellSize).toBe(twoCell);
    const cards=four.participantCards!;
    expect(cards[0]!.x-8).toBeGreaterThanOrEqual(48);
    expect(width-cards[3]!.x-cards[3]!.cardWidth-8).toBeGreaterThanOrEqual(48);
    for(let i=1;i<cards.length;i++)expect(cards[i]!.x-8-(cards[i-1]!.x+cards[i-1]!.cardWidth+8)).toBe(32);
  });
});
