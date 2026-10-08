import { describe, expect, it } from 'vitest';
import { TILE_STYLE_IDS } from '../src/domain/tileStyles';
import { BOARD_HEIGHT, type PieceDefinition, type TileStyle } from '../src/domain/types';
import {
  detailTierForCell,
  drawStyledTile,
  tileRenderSignature,
  type TileVisualState,
} from '../src/rendering/tileRenderer';
import { ANOMALY_BURN_PULSE_MS, COUNTDOWN_MS, FIXED_STEP_MS, LOCK_DELAY_MS, MatchEngine } from '../src/simulation/match';
import { activePiece } from '../src/simulation/tetrominoes';
import { clearFallDurationMs } from '../src/simulation/clearPresentation';

const TEST_ANOMALY: PieceDefinition = {
  id: 'styled-test-anomaly',
  source: 'anomaly',
  settledKind: 'anomaly',
  rotations: [[{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }]],
};

class RecordingGraphics {
  readonly calls: Array<[string, ...unknown[]]> = [];
  private record(name: string, ...args: unknown[]): this { this.calls.push([name, ...args]); return this; }
  fillStyle(...args: unknown[]): this { return this.record('fillStyle', ...args); }
  lineStyle(...args: unknown[]): this { return this.record('lineStyle', ...args); }
  fillRoundedRect(...args: unknown[]): this { return this.record('fillRoundedRect', ...args); }
  strokeRoundedRect(...args: unknown[]): this { return this.record('strokeRoundedRect', ...args); }
  fillRect(...args: unknown[]): this { return this.record('fillRect', ...args); }
  strokeRect(...args: unknown[]): this { return this.record('strokeRect', ...args); }
  lineBetween(...args: unknown[]): this { return this.record('lineBetween', ...args); }
  fillCircle(...args: unknown[]): this { return this.record('fillCircle', ...args); }
  fillTriangle(...args: unknown[]): this { return this.record('fillTriangle', ...args); }
}

function draw(style: TileStyle, kind: 'T' | 'anomaly' | 'garbage' = 'T', size = 24, state: TileVisualState = 'active') {
  const graphics = new RecordingGraphics();
  drawStyledTile(graphics as never, { style, kind, x: 0, y: 0, size, color: 0x55c978, alpha: 1, state });
  return graphics.calls;
}

describe('procedural tile renderer', () => {
  it('gives Classic a clean square body without a raised construction detail', () => {
    expect(draw('classic').map(([name]) => name)).toEqual([
      'fillStyle', 'fillRect', 'fillStyle', 'fillRect',
      'fillStyle', 'fillRect', 'fillStyle', 'fillRect',
    ]);
    expect(draw('classic').map(([name]) => name)).not.toContain('fillCircle');
  });

  it('keeps the prior glossy raised-detail brick as Construction', () => {
    expect(draw('construction-bricks').map(([name]) => name)).toEqual([
      'fillStyle', 'fillRoundedRect', 'fillStyle', 'fillRoundedRect',
      'fillStyle', 'fillRoundedRect', 'fillStyle', 'fillCircle',
      'fillStyle', 'fillCircle', 'lineStyle', 'strokeRoundedRect',
    ]);
  });

  it('does not flatten ordinary materials with one universal perimeter outline', () => {
    for (const style of TILE_STYLE_IDS) {
      expect(draw(style).slice(-2).map(([name]) => name)).not.toEqual(['lineStyle', 'strokeRect']);
    }
  });

  it('does not add cross-shaped connector strips behind ordinary tiles', () => {
    for (const style of TILE_STYLE_IDS) {
      for (const state of ['active', 'settled'] as const) {
        const calls = draw(style, 'T', 24, state);
        expect(calls).not.toContainEqual(['fillRect', 0, 9.84, 24, 4.32]);
        expect(calls).not.toContainEqual(['fillRect', 9.84, 0, 4.32, 24]);
      }
    }
  });

  it('gives all seven original materials distinct bounded primitive signatures', () => {
    const signatures = TILE_STYLE_IDS.map((style) => draw(style).map(([name]) => name).join(','));
    expect(new Set(signatures).size).toBe(7);
    expect(signatures.every((signature) => !/text|image|sprite/i.test(signature))).toBe(true);
    const semanticSignatures = TILE_STYLE_IDS.map((style) => tileRenderSignature({
      style, kind: 'T', size: 24, state: 'active',
    }));
    expect(new Set(semanticSignatures.map(({ silhouette }) => silhouette)).size).toBe(7);
    expect(new Set(semanticSignatures.map(({ surfacePattern }) => surfacePattern)).size).toBe(7);
  });

  it('drops fine detail but keeps material contrast at the smallest cells', () => {
    expect(detailTierForCell(8)).toBe(0);
    expect(detailTierForCell(16)).toBe(1);
    expect(detailTierForCell(24)).toBe(2);
    for (const style of TILE_STYLE_IDS) {
      const calls = draw(style, 'T', 8);
      expect(calls.some(([name]) => name === 'fillRect' || name === 'fillRoundedRect' || name === 'fillTriangle')).toBe(true);
      expect(calls.length).toBeGreaterThanOrEqual(4);
    }
    expect(draw('sea-crystals', 'T', 8).length).toBeLessThan(draw('sea-crystals', 'T', 24).length);
  });

  it('represents active, ghost, preview, and settled ordinary states for every style', () => {
    const states: TileVisualState[] = ['active', 'ghost', 'preview', 'settled'];
    for (const style of TILE_STYLE_IDS) {
      for (const state of states) {
        expect(tileRenderSignature({ style, kind: 'I', size: 18, state })).toMatchObject({
          material: style, state, usesGameplayColor: true,
        });
        expect(draw(style, 'T', 18, state).length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps hazard rendering invariant across participant styles', () => {
    const signatures = TILE_STYLE_IDS.map((style) => tileRenderSignature({ style, kind: 'garbage', size: 18, state: 'settled' }));
    expect(new Set(signatures.map(({ material }) => material))).toEqual(new Set(['neutral-hazard']));
    const drawings = TILE_STYLE_IDS.map((style) => JSON.stringify(draw(style, 'garbage', 18, 'settled')));
    expect(new Set(drawings).size).toBe(1);
  });

  it('composes every material with all universal static anomaly cues', () => {
    for (const style of TILE_STYLE_IDS) {
      expect(tileRenderSignature({ style, kind: 'anomaly', size: 18, state: 'settled' }).anomalyCues).toEqual([
        'violet-magenta', 'double-outline', 'diamond-mark', 'luminous-overlay',
      ]);
      const names = draw(style, 'anomaly', 18, 'settled').map(([name]) => name);
      expect(names.filter((name) => name === 'lineStyle').length).toBeGreaterThanOrEqual(2);
      expect(names.filter((name) => name === 'fillTriangle').length).toBeGreaterThanOrEqual(2);
      expect(names).toContain('fillCircle');
    }
  });

  it('does not rely on time or motion for preview, ghost, or settled anomaly identity', () => {
    for (const state of ['preview', 'ghost', 'settled'] as const) {
      const first = draw('forest-mosaic', 'anomaly', 16, state);
      expect(draw('forest-mosaic', 'anomaly', 16, state)).toEqual(first);
    }
  });

  it('keeps simulation geometry identical when participant materials differ', () => {
    const base = [
      { id: 'p1', label: 'P1', controller: 'human-1' as const },
      { id: 'p2', label: 'P2', controller: 'human-2' as const },
    ];
    const classic = new MatchEngine(base.map((config) => ({ ...config, tileStyle: 'classic' as const })), 404);
    const styled = new MatchEngine(base.map((config, index) => ({
      ...config, tileStyle: index === 0 ? 'stone-fortress' as const : 'marmalade' as const,
    })), 404);
    for (let step = 0; step < 250; step += 1) {
      classic.step(1000 / 60);
      styled.step(1000 / 60);
    }
    expect(styled.state.participants.map(({ board, score, placedPieces }) => ({ board, score, placedPieces }))).toEqual(
      classic.state.participants.map(({ board, score, placedPieces }) => ({ board, score, placedPieces })),
    );
  });

  it('renders one shared anomaly geometry through different owner materials', () => {
    const engine = new MatchEngine([
      { id: 'p1', label: 'P1', controller: 'human-1', tileStyle: 'stone-fortress' },
      { id: 'p2', label: 'P2', controller: 'human-2', tileStyle: 'marmalade' },
    ], 919);
    engine.step(COUNTDOWN_MS);
    engine.state.participants[0]!.placedPieces = 10;
    engine.step(FIXED_STEP_MS);
    const [first, second] = engine.state.participants;
    expect(first?.board.nextPiece).toEqual(second?.board.nextPiece);
    const firstSignature = tileRenderSignature({ style: first!.resolvedTileStyle, kind: 'anomaly', size: 18, state: 'preview' });
    const secondSignature = tileRenderSignature({ style: second!.resolvedTileStyle, kind: 'anomaly', size: 18, state: 'preview' });
    expect(firstSignature.material).toBe('stone-fortress');
    expect(secondSignature.material).toBe('marmalade');
    expect(firstSignature.anomalyCues).toEqual(secondSignature.anomalyCues);
  });

  it('keeps styled anomaly scoring, burning, and no-attack behavior unchanged', () => {
    const engine = new MatchEngine([
      { id: 'p1', label: 'P1', controller: 'human-1', tileStyle: 'sea-crystals' },
      { id: 'p2', label: 'P2', controller: 'human-2', tileStyle: 'pixel-adventure' },
    ], 121);
    engine.step(COUNTDOWN_MS);
    const participant = engine.state.participants[0]!;
    participant.board.grid.forEach((row) => row.fill(null));
    participant.board.grid[BOARD_HEIGHT - 2]?.fill('garbage');
    participant.board.grid[BOARD_HEIGHT - 1]?.fill('garbage');
    for (let y = BOARD_HEIGHT - 4; y <= BOARD_HEIGHT - 3; y += 1) {
      participant.board.grid[y]?.fill('J');
      participant.board.grid[y]![4] = null;
      participant.board.grid[y]![5] = null;
    }
    participant.board.active = activePiece(TEST_ANOMALY, 0, 3, BOARD_HEIGHT - 4);
    participant.board.lockElapsedMs = LOCK_DELAY_MS - FIXED_STEP_MS;
    engine.step(FIXED_STEP_MS);
    expect(participant.score).toBe(0);
    engine.step(180);
    engine.step(clearFallDurationMs(2));
    expect(participant.score).toBe(300);
    expect(participant.board.grid.flat().filter((cell) => cell === 'garbage')).toHaveLength(20);
    expect(engine.state.anomalyCueEvents).toHaveLength(1);engine.step(800);
    expect(engine.state.anomalyBurnEvents[0]).toMatchObject({ participantId: 'p1' });
    expect(engine.state.anomalyBurnEvents[0]?.rows).toHaveLength(2);
    engine.step(ANOMALY_BURN_PULSE_MS);
    expect(participant.board.grid.flat().filter((cell) => cell === 'garbage')).toHaveLength(20);
    engine.step(clearFallDurationMs(2));
    expect(participant.board.grid.flat().filter((cell) => cell === 'garbage')).toHaveLength(0);
    expect(engine.state.pendingConflict).toBeNull();
    expect(engine.state.participants[1]!.board.grid.flat().filter(Boolean)).toHaveLength(0);
  });
});
