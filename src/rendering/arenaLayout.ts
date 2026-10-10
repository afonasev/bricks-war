export const ARENA_CARD_GAP = 4;
export const LOCAL_ARENA_CARD_GAP = 16;
export const ARENA_EDGE_PADDING = 4;
export const ARENA_CARD_HEADER_HEIGHT = 52;
export const ARENA_CARD_HORIZONTAL_PADDING = 4;
export const ARENA_CARD_BOTTOM_PADDING = 4;

export type ArenaLayoutMode = 'horizontal' | 'grid-2x2' | 'mobile-solo';
export interface ArenaCardLayout { x: number; y: number; cardWidth: number; cardHeight: number; cellSize: number; headerHeight?: number; }

export interface ArenaLayout {
  mode: ArenaLayoutMode;
  columns: number;
  rows: number;
  slotWidth: number;
  slotHeight: number;
  cardWidth: number;
  cardHeight: number;
  cellSize: number;
  gap?: number;
  participantCards?: ArenaCardLayout[];
}

export function chooseMobileSoloLayout(
  width: number,
  height: number,
  participantCount: number,
  controlsReservedHeight = 0,
): ArenaLayout {
  const playfieldHeight = Math.max(0, height - controlsReservedHeight);
  const opponents = Math.max(0, participantCount - 1);
  const playerHeaderHeight = width > height ? 28 : 36;
  if (width > height) {
    const playerTop = ARENA_EDGE_PADDING;
    const playerCell = Math.max(4, Math.floor((playfieldHeight - playerTop - playerHeaderHeight - ARENA_CARD_BOTTOM_PADDING - ARENA_EDGE_PADDING) / 20));
    const playerWidth = playerCell * 10 + ARENA_CARD_HORIZONTAL_PADDING;
    const playerHeight = playerHeaderHeight + playerCell * 20 + ARENA_CARD_BOTTOM_PADDING;
    const groupGap = 14;
    const groupWidth = (playerWidth * participantCount) + (groupGap * Math.max(0, participantCount - 1));
    const groupX = (width - groupWidth) / 2;
    const player: ArenaCardLayout = {
      x: groupX,
      y: playerTop,
      cardWidth: playerWidth,
      cardHeight: playerHeight,
      cellSize: playerCell,
      headerHeight: playerHeaderHeight,
    };
    const opponentGap = groupGap;
    const opponentCell = opponents ? playerCell : 0;
    const opponentWidth = opponentCell * 10 + ARENA_CARD_HORIZONTAL_PADDING;
    const opponentHeight = playerHeaderHeight + opponentCell * 20 + ARENA_CARD_BOTTOM_PADDING;
    const opponentCards = Array.from({ length: opponents }, (_, index): ArenaCardLayout => {
      return {
        x: groupX + playerWidth + opponentGap + index * (opponentWidth + opponentGap),
        y: player.y,
        cardWidth: opponentWidth,
        cardHeight: opponentHeight,
        cellSize: opponentCell,
        headerHeight: playerHeaderHeight,
      };
    });
    return { mode: 'mobile-solo', columns: 1, rows: 1, slotWidth: width, slotHeight: playfieldHeight, cardWidth: playerWidth, cardHeight: playerHeight, cellSize: playerCell, participantCards: [player, ...opponentCards] };
  }
  const compact = playfieldHeight < 360;
  const leftRail = 12;
  const rightRail = opponents ? 82 : 12;
  const sideGap = 4;
  const playerTop = 50;
  const playerCell = Math.max(compact ? 4 : 8, Math.floor(Math.min(
    (width - (ARENA_EDGE_PADDING * 2) - leftRail - rightRail - (sideGap * 2)) / 10,
    (playfieldHeight - playerTop - playerHeaderHeight - ARENA_CARD_BOTTOM_PADDING - ARENA_EDGE_PADDING) / 20,
  )));
  const playerWidth = playerCell * 10 + ARENA_CARD_HORIZONTAL_PADDING;
  const playerHeight = playerHeaderHeight + playerCell * 20 + ARENA_CARD_BOTTOM_PADDING;
  const player: ArenaCardLayout = { x: opponents ? leftRail : (width - playerWidth) / 2, y: Math.max(playerTop, Math.floor((playfieldHeight - playerHeight) / 2)), cardWidth: playerWidth, cardHeight: playerHeight, cellSize: playerCell, headerHeight: playerHeaderHeight };
  const opponentGap = 6;
  const opponentCell = opponents ? Math.max(compact ? 2 : 3, Math.min(7, Math.floor((rightRail - ARENA_CARD_HORIZONTAL_PADDING) / 10))) : 0;
  const opponentWidth = opponentCell * 10 + ARENA_CARD_HORIZONTAL_PADDING;
  const opponentHeight = playerHeaderHeight + opponentCell * 20 + ARENA_CARD_BOTTOM_PADDING;
  const opponentStackHeight = (opponentHeight * opponents) + (opponentGap * Math.max(0, opponents - 1));
  const centeredOpponentY = player.y + ((player.cardHeight - opponentStackHeight) / 2);
  const opponentY = Math.max(ARENA_EDGE_PADDING, Math.min(centeredOpponentY, playfieldHeight - opponentStackHeight - ARENA_EDGE_PADDING));
  const opponentCards = Array.from({ length: opponents }, (_, index): ArenaCardLayout => {
    return {
      x: width - leftRail - opponentWidth,
      y: opponentY + index * (opponentHeight + opponentGap),
      cardWidth: opponentWidth,
      cardHeight: opponentHeight,
      cellSize: opponentCell,
      headerHeight: playerHeaderHeight,
    };
  });
  return { mode: 'mobile-solo', columns: 1, rows: 1, slotWidth: width, slotHeight: playfieldHeight, cardWidth: playerWidth, cardHeight: playerHeight, cellSize: playerCell, participantCards: [player, ...opponentCards] };
}

function measureLayout(
  width: number,
  height: number,
  columns: number,
  rows: number,
  mode: ArenaLayoutMode,
  gap: number,
): ArenaLayout {
  const slotWidth = (
    width - (ARENA_EDGE_PADDING * 2) - (gap * (columns - 1))
  ) / columns;
  const slotHeight = (
    height - (ARENA_EDGE_PADDING * 2) - (gap * (rows - 1))
  ) / rows;
  const cellSize = Math.max(0, Math.floor(Math.min(
    (slotWidth - ARENA_CARD_HORIZONTAL_PADDING) / 10,
    (slotHeight - ARENA_CARD_HEADER_HEIGHT - ARENA_CARD_BOTTOM_PADDING) / 20,
  )));
  const cardWidth = (cellSize * 10) + ARENA_CARD_HORIZONTAL_PADDING;
  const cardHeight = ARENA_CARD_HEADER_HEIGHT + (cellSize * 20) + ARENA_CARD_BOTTOM_PADDING;
  return { mode, columns, rows, slotWidth, slotHeight, cardWidth, cardHeight, cellSize, gap };
}

export function chooseArenaLayout(width: number, height: number, participantCount: number, gap = ARENA_CARD_GAP): ArenaLayout {
  const count = Math.max(1, Math.min(4, participantCount));
  const horizontal = measureLayout(width, height, count, 1, 'horizontal', gap);
  if (count <= 2) return horizontal;
  const grid = measureLayout(width, height, 2, 2, 'grid-2x2', gap);
  return grid.cellSize > horizontal.cellSize ? grid : horizontal;
}

/** Network projection keeps ordinary own-field geometry and readable human miniatures. */
export function chooseNetworkLayout(width: number, height: number, count: number, mobile = false): ArenaLayout {
  const others = Math.max(0, Math.min(3, count - 1));
  const portrait = mobile && height > width;
  const reserved = mobile ? (portrait ? 42 : 28) : 0;
  const topReserved = mobile && !portrait ? 42 : 0;
  const availableHeight = height - reserved - topReserved;
  const base = mobile
    ? chooseMobileSoloLayout(width, height - topReserved, others + 1, reserved)
    : chooseArenaLayout(width, height, 1);
  const own = mobile ? { ...base.participantCards![0]! } : {
    x: 0, y: (height - base.cardHeight) / 2, cardWidth: base.cardWidth,
    cardHeight: base.cardHeight, cellSize: base.cellSize, headerHeight: ARENA_CARD_HEADER_HEIGHT,
  };
  if (!portrait) own.cellSize = Math.min(own.cellSize, Math.floor((width - 8 - others * 14 - 4 * (others + 1)) / (10 + others * 5)));
  if (portrait) {
    own.headerHeight = ARENA_CARD_HEADER_HEIGHT;
    own.cardHeight = own.headerHeight + own.cellSize * 20 + ARENA_CARD_BOTTOM_PADDING;
    own.y = Math.max(50, Math.floor((availableHeight - own.cardHeight) / 2));
  }
  // Human names wrap; unlike local AI abbreviations they need a complete label area.
  const miniHeader = portrait ? 88 : 64;
  const gap = portrait ? 6 : 14;
  const miniCell = portrait
    ? Math.max(2, Math.min(7, Math.floor(((availableHeight - 50 - gap * Math.max(0, others - 1)) / Math.max(1, others) - miniHeader - ARENA_CARD_BOTTOM_PADDING) / 20)))
    : Math.max(2, Math.floor(own.cellSize / 2));
  const miniWidth = portrait ? 74 : Math.max(120, miniCell * 10 + ARENA_CARD_HORIZONTAL_PADDING);
  const minis: ArenaCardLayout[] = Array.from({ length: others }, () => ({
    x: 0, y: 0, cardWidth: miniWidth, cardHeight: miniHeader + miniCell * 20 + ARENA_CARD_BOTTOM_PADDING,
    cellSize: miniCell, headerHeight: miniHeader,
  }));
  if (portrait) {
    const stackHeight = others * (minis[0]?.cardHeight ?? 0) + gap * Math.max(0, others - 1);
    const top = Math.max(50, Math.min(own.y + (own.cardHeight - stackHeight) / 2, availableHeight - stackHeight));
    minis.forEach((card, index) => { card.x = width - 12 - miniWidth; card.y = top + index * (card.cardHeight + gap); });
  } else {
    // Width-limited windows reserve the miniature rail before maximizing the own board.
    const room = width - ARENA_EDGE_PADDING * 2 - others * (miniWidth + gap);
    own.cellSize = Math.max(2, Math.min(own.cellSize, Math.floor((room - ARENA_CARD_HORIZONTAL_PADDING) / 10)));
    own.headerHeight = ARENA_CARD_HEADER_HEIGHT;
    own.cardWidth = own.cellSize * 10 + ARENA_CARD_HORIZONTAL_PADDING;
    own.cardHeight = own.headerHeight + own.cellSize * 20 + ARENA_CARD_BOTTOM_PADDING;
    if (own.cardHeight > availableHeight - 8) {
      own.cellSize = Math.max(2, Math.floor((availableHeight - own.headerHeight - 12) / 20));
      own.cardWidth = own.cellSize * 10 + ARENA_CARD_HORIZONTAL_PADDING;
      own.cardHeight = own.headerHeight + own.cellSize * 20 + ARENA_CARD_BOTTOM_PADDING;
    }
    const totalWidth = own.cardWidth + others * (miniWidth + gap);
    own.x = (width - totalWidth) / 2; own.y = (availableHeight - own.cardHeight) / 2;
    minis.forEach((card, index) => { card.x = own.x + own.cardWidth + gap + index * (miniWidth + gap); card.y = (availableHeight - card.cardHeight) / 2; });
  }
  if (topReserved) {
    own.y += topReserved;
    minis.forEach((card) => { card.y += topReserved; });
  }
  return { ...base, mode: 'mobile-solo', columns: 1, rows: 1, slotWidth: width, slotHeight: height,
    cardWidth: own.cardWidth, cardHeight: own.cardHeight, cellSize: own.cellSize, participantCards: [own, ...minis] };
}
