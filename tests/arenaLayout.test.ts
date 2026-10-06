import { describe, expect, it } from 'vitest';
import { chooseArenaLayout, chooseMobileSoloLayout, chooseNetworkLayout } from '../src/rendering/arenaLayout';

describe('adaptive arena layout', () => {
  it.each([
    { name: 'mobile 360x800', width: 360, height: 800, mobile: true },
    { name: 'mobile 390x844', width: 390, height: 844, mobile: true },
    { name: 'mobile 844x390', width: 844, height: 390, mobile: true },
    { name: 'desktop 1280x480', width: 1280, height: 418, mobile: false },
    { name: 'desktop 800x900', width: 800, height: 900, mobile: false },
    { name: 'desktop 1600x900', width: 1600, height: 900, mobile: false },
  ])('keeps the network fields within the viewport for $name', ({ width, height, mobile }) => {
    for (const count of [2, 3, 4]) {
      const layout = chooseNetworkLayout(width, height, count, mobile);
      const cards = layout.participantCards!;
      expect(cards).toHaveLength(count);
      if (mobile) {
        expect(layout.mode).toBe('mobile-solo');
        expect(cards[0]!.cellSize).toBeGreaterThan(cards[1]!.cellSize);
        for (const card of cards) {
          expect(card.y).toBeGreaterThanOrEqual(height > width ? 50 : 4);
          expect(card.y + card.cardHeight).toBeLessThanOrEqual(height - 30);
        }
      } else {
        for (let i = 1; i < cards.length; i += 1) {
          expect(cards[i]!.x).toBeGreaterThanOrEqual(cards[i - 1]!.x + cards[i - 1]!.cardWidth);
        }
        for (const card of cards) {
          expect(card.y).toBeGreaterThanOrEqual(0);
          expect(card.y + card.cardHeight).toBeLessThanOrEqual(height);
        }
      }
      for (let i = 0; i < cards.length; i += 1) {
        const card = cards[i]!;
        expect(card.x).toBeGreaterThanOrEqual(0);
        expect(card.x + card.cardWidth).toBeLessThanOrEqual(width);
        for (let j = i + 1; j < cards.length; j += 1) {
          const other = cards[j]!;
          const overlaps = card.x < other.x + other.cardWidth && other.x < card.x + card.cardWidth
            && card.y < other.y + other.cardHeight && other.y < card.y + card.cardHeight;
          expect(overlaps).toBe(false);
        }
      }
    }
  });

  it.each([[360, 800], [390, 844]])('matches ordinary portrait primary cells at %ix%i', (width, height) => {
    expect(chooseNetworkLayout(width, height, 4, true).cellSize).toBe(chooseMobileSoloLayout(width, height, 4, 42).cellSize);
  });

  it('uses ordinary full-height desktop cells when the miniature rail fits', () => {
    expect(chooseNetworkLayout(1600, 838, 4).cellSize).toBe(chooseArenaLayout(1600, 838, 1).cellSize);
  });

  it('keeps four players in one horizontal row on a landscape arena when that makes cells larger', () => {
    const layout = chooseArenaLayout(1440, 902, 4);
    expect(layout).toMatchObject({ mode: 'horizontal', columns: 4, rows: 1, cellSize: 35 });
    expect(layout.cardWidth).toBe(354);
    expect(layout.cardHeight).toBe(756);
    expect(layout.cardHeight).toBeLessThan(layout.slotHeight);
  });

  it('uses a 2x2 grid only when a tall arena makes its cells larger', () => {
    const layout = chooseArenaLayout(800, 1142, 4);
    expect(layout).toMatchObject({ mode: 'grid-2x2', columns: 2, rows: 2, cellSize: 25 });
  });

  it('applies the same maximum-cell rule to three players', () => {
    expect(chooseArenaLayout(1440, 902, 3).mode).toBe('horizontal');
    expect(chooseArenaLayout(800, 1142, 3).mode).toBe('horizontal');
    expect(chooseArenaLayout(800, 1182, 3)).toMatchObject({ mode: 'grid-2x2', cellSize: 26 });
  });

  it('always keeps two players side by side', () => {
    expect(chooseArenaLayout(740, 1200, 2)).toMatchObject({ mode: 'horizontal', columns: 2, rows: 1 });
  });

  it('wraps a solo card tightly around its maximum-height board', () => {
    const layout = chooseArenaLayout(1440, 902, 1);
    expect(layout).toMatchObject({ columns: 1, rows: 1, cellSize: 41, cardWidth: 414, cardHeight: 876 });
    expect(layout.cardWidth).toBeLessThan(layout.slotWidth / 2);
    expect(layout.slotHeight - layout.cardHeight).toBeLessThan(20);
  });

  it('derives every tight card from the board cell size', () => {
    for (let count = 1; count <= 4; count += 1) {
      const layout = chooseArenaLayout(1280, 720, count);
      expect(layout.cardWidth).toBe((layout.cellSize * 10) + 4);
      expect(layout.cardHeight).toBe(52 + (layout.cellSize * 20) + 4);
      expect(layout.cardWidth).toBeLessThanOrEqual(layout.slotWidth);
      expect(layout.cardHeight).toBeLessThanOrEqual(layout.slotHeight);
    }
  });

  it('gives the mobile player a dominant board between compact side opponents', () => {
    const controlsReservedHeight = 0;
    const layout = chooseMobileSoloLayout(390, 700, 3, controlsReservedHeight);
    expect(layout.mode).toBe('mobile-solo');
    expect(layout.participantCards).toHaveLength(3);
    const [player, firstAi, secondAi] = layout.participantCards!;
    expect(player!.cellSize).toBeGreaterThan(firstAi!.cellSize);
    expect(firstAi!.x).toBeGreaterThan(player!.x + player!.cardWidth);
    expect(secondAi!.x).toBeGreaterThan(player!.x + player!.cardWidth);
    expect(firstAi!.x).toBe(secondAi!.x);
    expect(firstAi!.y + firstAi!.cardHeight).toBeLessThanOrEqual(secondAi!.y);
    expect((firstAi!.y + secondAi!.y + secondAi!.cardHeight) / 2).toBe((player!.y + player!.cardHeight / 2));
    expect(secondAi!.x + secondAi!.cardWidth).toBeLessThanOrEqual(386);
    expect(layout.participantCards![0]!.y + layout.participantCards![0]!.cardHeight).toBeLessThanOrEqual(700 - controlsReservedHeight);
  });

  it('fits three compact opponents into the right rail on a portrait phone', () => {
    const layout = chooseMobileSoloLayout(390, 700, 4);
    const [player, firstAi, secondAi, thirdAi] = layout.participantCards!;
    expect(layout.participantCards).toHaveLength(4);
    expect(firstAi!.x).toBeGreaterThan(player!.x + player!.cardWidth);
    expect(firstAi!.x).toBe(secondAi!.x);
    expect(secondAi!.x).toBe(thirdAi!.x);
    expect(firstAi!.y + firstAi!.cardHeight).toBeLessThanOrEqual(secondAi!.y);
    expect(secondAi!.y + secondAi!.cardHeight).toBeLessThanOrEqual(thirdAi!.y);
    expect((firstAi!.y + thirdAi!.y + thirdAi!.cardHeight) / 2).toBe(player!.y + player!.cardHeight / 2);
    expect(thirdAi!.y + thirdAi!.cardHeight).toBeLessThanOrEqual(700);
  });

  it('uses the full height for the player board on a compact landscape phone', () => {
    const layout = chooseMobileSoloLayout(844, 390, 3, 64);
    const [player, firstAi, secondAi] = layout.participantCards!;
    expect(player!.cellSize).toBe(firstAi!.cellSize);
    expect(player!.cardHeight).toBeGreaterThan(250);
    expect(firstAi!.x).toBeGreaterThan(player!.x + player!.cardWidth);
    expect(secondAi!.x).toBeGreaterThan(player!.x + player!.cardWidth);
    expect(firstAi!.x + firstAi!.cardWidth).toBeLessThanOrEqual(secondAi!.x);
    expect(secondAi!.x + secondAi!.cardWidth).toBeLessThanOrEqual(840);
    expect((player!.x + secondAi!.x + secondAi!.cardWidth) / 2).toBe(422);
  });
});
