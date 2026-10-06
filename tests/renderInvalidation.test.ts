import { describe, expect, it } from 'vitest';
import { generateAnomaly } from '../src/simulation/anomaly';
import { spawnPiece } from '../src/simulation/board';
import { MatchEngine } from '../src/simulation/match';
import { pieceDefinition } from '../src/simulation/tetrominoes';
import { playfieldRenderKey, staticPlayfieldRenderKey } from '../src/rendering/renderInvalidation';
import { humanPair } from './fixtures';

function key(engine: MatchEngine, nowMs = 0): string {
  return playfieldRenderKey(engine.state, 'horizontal:2:1:24', 1200, 800, nowMs, false);
}

describe('playfield render invalidation', () => {
  it('does not redraw an unchanged ordinary board just because another animation frame passed', () => {
    const engine = new MatchEngine(humanPair(), 12);
    expect(key(engine, 0)).toBe(key(engine, 500));
  });

  it('redraws dynamic content for active-piece and visible-effect changes', () => {
    const engine = new MatchEngine(humanPair(), 13);
    const initial = key(engine);
    engine.state.participants[0]!.board.active!.y += 1;
    expect(key(engine)).not.toBe(initial);
    const moved = key(engine);
    engine.state.pressurePulseMs = 650;
    expect(key(engine)).not.toBe(moved);
  });

  it('uses explicit board revisions for static layer invalidation without reading grid cells', () => {
    const engine = new MatchEngine(humanPair(), 15);
    const first = staticPlayfieldRenderKey(engine.state, 'horizontal:2:1:24', 1200, 800);
    engine.state.participants[0]!.board.grid.at(-1)![0] = 'T';
    expect(staticPlayfieldRenderKey(engine.state, 'horizontal:2:1:24', 1200, 800)).toBe(first);
    engine.state.participants[0]!.board.staticRenderRevision += 1;
    expect(staticPlayfieldRenderKey(engine.state, 'horizontal:2:1:24', 1200, 800)).not.toBe(first);
  });

  it('invalidates the static preview layer when the scheduled piece advances', () => {
    const engine = new MatchEngine(humanPair(), 16);
    const participant = engine.state.participants[0]!;
    const first = staticPlayfieldRenderKey(engine.state, 'horizontal:2:1:24', 1200, 800);
    participant.board.nextPiece = pieceDefinition('O');
    participant.board.staticRenderRevision += 1;
    expect(staticPlayfieldRenderKey(engine.state, 'horizontal:2:1:24', 1200, 800)).not.toBe(first);
  });

  it('keeps animated anomaly outlines moving at a bounded 20 fps', () => {
    const engine = new MatchEngine(humanPair(), 14);
    spawnPiece(engine.state.participants[0]!.board, generateAnomaly(14, 1));
    expect(key(engine, 10)).toBe(key(engine, 49));
    expect(key(engine, 60)).not.toBe(key(engine, 10));
  });
});
