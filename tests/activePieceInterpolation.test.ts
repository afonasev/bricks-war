import { describe, expect, it } from 'vitest';
import { ActivePieceInterpolation } from '../src/rendering/activePieceInterpolation';
import { MatchEngine } from '../src/simulation/match';
import { humanPair } from './fixtures';

describe('active-piece interpolation', () => {
  it('interpolates a consecutive translation without changing the logical piece', () => {
    const engine = new MatchEngine(humanPair(), 61);
    const tracker = new ActivePieceInterpolation();
    const participant = engine.state.participants[0]!;
    tracker.reset(engine.state.participants);
    const before = tracker.snapshot(engine.state.participants);
    participant.board.active!.y += 1;
    tracker.commit(before, engine.state.participants);

    expect(tracker.renderPiece(participant, 0.5, false)?.y).toBe(participant.board.active!.y - 0.5);
    expect(participant.board.active!.y).toBe(2);
  });

  it('snaps after rotation, spawn, and reduced-motion rendering', () => {
    const engine = new MatchEngine(humanPair(), 62);
    const tracker = new ActivePieceInterpolation();
    const participant = engine.state.participants[0]!;
    tracker.reset(engine.state.participants);
    const before = tracker.snapshot(engine.state.participants);
    participant.board.active!.rotation = 1;
    tracker.commit(before, engine.state.participants);
    expect(tracker.renderPiece(participant, 0.5, false)?.rotation).toBe(1);
    expect(tracker.renderPiece(participant, 0.5, false)?.y).toBe(participant.board.active!.y);

    const translated = tracker.snapshot(engine.state.participants);
    participant.board.active!.y += 1;
    tracker.commit(translated, engine.state.participants);
    expect(tracker.renderPiece(participant, 0.5, true)?.y).toBe(participant.board.active!.y);
  });
});
