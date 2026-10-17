import type * as Phaser from 'phaser/dist/phaser.esm.js';
import type { MatchVariant, TeamId } from '../domain/types';

/** Tile material review remains isolated from the shared player housing. */
export function usesWorkshopStudy(mobile: boolean, network: boolean, count: number): boolean {
  return !mobile && !network && count === 1;
}

/** Brighter painted wood, retaining the existing green/cyan/purple/red slot identities. */
export function workshopPanelColor(slot: number, variant: MatchVariant, alive: boolean, teamId?: TeamId): number {
  if (!alive) return 0x918a7e;
  if (variant === 'teams') return (teamId ? teamId === 'team-2' : slot >= 2) ? 0x568fb9 : 0xc49a39;
  return [0x80a34e, 0x429caa, 0xa46ca9, 0xc56b52][Math.min(3, Math.max(0, slot))]!;
}

export function drawWorkshopHousing(g: Phaser.GameObjects.Graphics, x: number, y: number,
  width: number, _height: number, boardY: number, boardWidth: number, boardHeight: number, _color: number,
  danger = false, _spacious = true): void {
  // DOM housing uses the exact wood texture/CSS from the accepted concept.
  // Canvas retains the header backing and authoritative danger outline only.
  const bx = x + (width - boardWidth) / 2;
  g.fillStyle(0xfffbef, 1);
  g.fillRect(x, y, width, boardY - y);
  if (danger) {
    g.lineStyle(3, 0xff3042, 1);
    g.strokeRect(bx - 1, boardY - 1, boardWidth + 2, boardHeight + 2);
  }
}
