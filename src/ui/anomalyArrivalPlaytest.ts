import type { MatchEngine } from '../simulation/match';
import { BOARD_HEIGHT } from '../domain/types';
import { activePiece } from '../simulation/tetrominoes';
import { prepareClearPlaytest } from './clearPlaytest';

/** Local-only fixture: an actual threshold lock followed by the real shared transition. */
export function prepareAnomalyArrivalPlaytest(engine: MatchEngine): void {
  const trigger = engine.state.participants[0];
  if (!trigger || engine.state.isSurvival) return;
  trigger.placedPieces = engine.options.piecesPerLevel - 1;
  prepareClearPlaytest(trigger.board, 'normal', 1, 900);
  for (const participant of engine.state.participants.slice(1)) {
    participant.board.grid.forEach(row => row.fill(null));
    for (let x = 0; x < 10; x++) for (let y = BOARD_HEIGHT - 1; y >= BOARD_HEIGHT - 1 - (x % 3); y--) {
      if (x !== 4) participant.board.grid[y]![x] = 'J';
    }
    participant.board.active = activePiece('T', 1, 3, 7);
    participant.board.preparationRemainingMs = 10000;
    participant.board.lockElapsedMs = 0;
    participant.board.staticRenderRevision += 1;
  }
}
