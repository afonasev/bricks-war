import { BOARD_HEIGHT, BOARD_WIDTH, HIDDEN_ROWS, VISIBLE_HEIGHT, type ActivePiece, type Grid, type Rotation } from '../domain/types';
import { landingPiece } from '../simulation/board';
import { pieceCells } from '../simulation/tetrominoes';

export type PlayerEventRegion = 'upper' | 'lower';

export const LOWER_THIRD_START_ROW = HIDDEN_ROWS + Math.floor((VISIBLE_HEIGHT * 2) / 3);

function rotationsFor(active: ActivePiece): Rotation[] {
  return Array.from({ length: active.definition.rotations.length }, (_, rotation) => rotation as Rotation);
}

/**
 * A lower-third landing is actionable when any legal final pose of the current
 * figure occupies that part of the visible board. This intentionally considers
 * final legality, not the current transient movement path.
 */
export function hasLowerThirdLanding(grid: Grid, active: ActivePiece | null): boolean {
  if (!active) return false;

  return rotationsFor(active).some((rotation) => (
    Array.from({ length: BOARD_WIDTH + 8 }, (_, index) => index - 4).some((x) => {
      const landed = landingPiece(grid, { definition: active.definition, rotation, x, y: 0 });
      return landed !== null && pieceCells(landed).some((cell) => (
        cell.y >= LOWER_THIRD_START_ROW && cell.y < BOARD_HEIGHT
      ));
    })
  ));
}

export function playerEventRegion(grid: Grid, active: ActivePiece | null): PlayerEventRegion {
  return hasLowerThirdLanding(grid, active) ? 'upper' : 'lower';
}

export class PlayerEventRegionLatch {
  private readonly regions = new Map<string, { eventKey: string; region: PlayerEventRegion }>();

  resolve(participantId: string, eventKey: string, grid: Grid, active: ActivePiece | null): PlayerEventRegion {
    const current = this.regions.get(participantId);
    if (current?.eventKey === eventKey) return current.region;
    const region = playerEventRegion(grid, active);
    this.regions.set(participantId, { eventKey, region });
    return region;
  }

  release(participantId: string): void {
    this.regions.delete(participantId);
  }

  clear(): void {
    this.regions.clear();
  }
}
