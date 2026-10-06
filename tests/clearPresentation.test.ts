import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT, BOARD_WIDTH } from '../src/domain/types';
import { fireSamples, impactGainForLines, impactSamples } from '../src/audio/clearSounds';
import { AudioEventTracker } from '../src/audio/audioEvents';
import { clearFallDurationMs, completedRowIndices, settlingRows } from '../src/simulation/clearPresentation';
import { createEmptyGrid } from '../src/simulation/board';
import { ANOMALY_BURN_PULSE_MS, FIXED_STEP_MS, MatchEngine, scoreForLines } from '../src/simulation/match';
import { prepareClearPlaytest } from '../src/ui/clearPlaytest';

describe('line clear presentation', () => {
  it('maps surviving rows around separated clears and bottom cleanup', () => {
    const grid = createEmptyGrid();
    grid[17]![0] = 'J';
    grid[18]!.fill('I');
    grid[19]![1] = 'L';
    grid[20]!.fill('T');
    grid[21]!.fill('garbage');
    expect(completedRowIndices(grid)).toEqual([18, 20]);
    expect(settlingRows(grid, [18, 20], 1).map(({ fromY, toY }) => [fromY, toY])).toEqual([[17, 20], [19, 21]]);
  });

  for (const mode of ['normal', 'fire'] as const) {
    for (let lines = 1; lines <= 4; lines += 1) {
      it(`runs a real ${mode} ${lines}-line cycle and lands once`, () => {
        const engine = new MatchEngine([{ id: 'p1', label: 'Player', controller: 'human-1' }], 900 + lines, 2, {}, null, true);
        engine.state.phase = 'playing';
        const participant = engine.state.participants[0]!;
        prepareClearPlaytest(participant.board, mode, lines);
        const tracker = new AudioEventTracker();
        tracker.sync(engine.state);
        const initialSpawn = participant.board.spawnSerial;
        engine.step(FIXED_STEP_MS);
        const lockedGrid = participant.board.grid.map((row) => [...row]);
        expect(participant.score).toBe(0);
        expect(participant.placedPieces).toBe(0);
        expect(participant.board.active).toBeNull();
        expect(participant.board.spawnSerial).toBe(initialSpawn);
        expect(engine.state.anomalyBurnEvents).toHaveLength(0);
        expect(engine.state.clearPresentations).toHaveLength(1);
        expect(tracker.sync(engine.state).filter((event) => event.type === 'clear-impact')).toEqual([]);
        engine.step(180);
        expect(engine.state.clearPresentations[0]?.phase).toBe('fall');
        expect(engine.state.clearPresentations[0]?.rows.some((row) => row.toY > row.fromY)).toBe(true);
        expect(participant.board.grid).toEqual(lockedGrid);
        engine.step(clearFallDurationMs(lines));
        expect(engine.state.clearPresentations).toHaveLength(0);
        expect(participant.score).toBe(scoreForLines(lines));
        expect(participant.placedPieces).toBe(1);
        if (mode === 'fire') {
          expect(engine.state.anomalyBurnEvents).toHaveLength(1);
          expect(participant.board.spawnSerial).toBe(initialSpawn);
          const before = participant.board.grid.map((row) => [...row]);
          engine.step(ANOMALY_BURN_PULSE_MS / 2);
          expect(participant.board.grid).toEqual(before);
          engine.pause('manual');
          engine.step(ANOMALY_BURN_PULSE_MS);
          expect(participant.board.grid).toEqual(before);
          engine.resume('manual');
          engine.step(ANOMALY_BURN_PULSE_MS / 2);
          expect(engine.state.anomalyBurnEvents).toHaveLength(0);
          expect(engine.state.clearPresentations[0]?.phase).toBe('fall');
          expect(participant.board.grid).toEqual(before);
          engine.step(clearFallDurationMs(lines));
        }
        expect(participant.board.spawnSerial).toBe(initialSpawn + 1);
        expect(engine.state.clearImpactEvents.at(-1)).toMatchObject({ participantId: 'p1', lines });
        expect(tracker.sync(engine.state).filter((event) => event.type === 'clear-impact')).toEqual([{ type: 'clear-impact', lines, pan: 0 }]);
        expect(tracker.sync(engine.state).filter((event) => event.type === 'clear-impact')).toEqual([]);
        expect(participant.board.grid).toHaveLength(BOARD_HEIGHT);
        expect(participant.board.grid.every((row) => row.length === BOARD_WIDTH)).toBe(true);
      });
    }
  }

  it('uses one impact waveform with increasing gains and a fading fire tail', () => {
    const gains = [1, 2, 3, 4].map(impactGainForLines);
    expect(gains.every((gain, index) => index === 0 || gain > gains[index - 1]!)).toBe(true);
    const impact = impactSamples(48_000);
    expect(impact.length).toBeGreaterThan(40_000);
    const fire = fireSamples(48_000);
    const rms = (part: Float32Array) => Math.sqrt(part.reduce((sum, sample) => sum + sample * sample, 0) / part.length);
    expect(rms(fire.slice(-4_800))).toBeLessThan(rms(fire.slice(24_000, 28_800)) * 0.1);
  });

  it('keeps the fire texture low and varied instead of a steady hiss', () => {
    const fire = fireSamples(48_000).slice(4_800, 52_800);
    let energy = 0;
    let stepEnergy = 0;
    for (let index = 1; index < fire.length; index += 1) {
      energy += fire[index]! ** 2;
      stepEnergy += (fire[index]! - fire[index - 1]!) ** 2;
    }
    expect(Math.sqrt(stepEnergy / energy)).toBeLessThan(0.35);
    const windows = [];
    for (let start = 0; start < fire.length; start += 240) {
      const segment = fire.slice(start, start + 240);
      windows.push(Math.sqrt(segment.reduce((sum, sample) => sum + sample * sample, 0) / segment.length));
    }
    windows.sort((left, right) => left - right);
    expect(windows[Math.floor(windows.length * 0.95)]! / windows[Math.floor(windows.length * 0.5)]!).toBeGreaterThan(2);
  });

  it('retains the burn target and defers a conflict impact until after landing', () => {
    const engine = new MatchEngine([
      { id: 'p1', label: 'Player 1', controller: 'human-1' },
      { id: 'p2', label: 'Player 2', controller: 'human-2' },
    ], 935, 2, { conflictEnabled: true });
    engine.state.phase = 'playing';
    const participant = engine.state.participants[0]!;
    prepareClearPlaytest(participant.board, 'fire', 2);
    engine.step(FIXED_STEP_MS);
    engine.step(180);
    engine.step(clearFallDurationMs(2));
    expect(engine.state.anomalyBurnEvents[0]?.rows.at(-1)?.every((cell) => cell === 'garbage')).toBe(false);
    engine.state.pendingConflict = {
      serial: 1,
      remainingWarningMs: 50,
      senders: [{ participantId: 'p2', rows: 1, recipientIds: ['p1'] }],
      incomingRows: { p1: 1 },
    };
    engine.step(50);
    expect(engine.state.pendingConflict?.remainingWarningMs).toBe(0.001);
    expect(engine.state.anomalyBurnEvents[0]?.rows.at(-1)?.every((cell) => cell === 'garbage')).toBe(false);
    engine.step(ANOMALY_BURN_PULSE_MS);
    expect(engine.state.anomalyBurnEvents).toHaveLength(0);
    engine.step(clearFallDurationMs(2));
    expect(participant.board.grid.at(-1)?.every((cell) => cell === 'garbage')).toBe(true);
  });

  it('queues survival pressure until the completed line lands', () => {
    const engine = new MatchEngine([{ id: 'p1', label: 'Player', controller: 'human-1' }], 941, 2, {}, null, true);
    engine.state.phase = 'playing';
    const participant = engine.state.participants[0]!;
    prepareClearPlaytest(participant.board, 'normal', 1);
    engine.step(FIXED_STEP_MS);
    const lockedGrid = participant.board.grid.map((row) => [...row]);
    const spawnSerial = participant.board.spawnSerial;
    engine.state.nextPressureAtMs = engine.state.elapsedMs + 1;
    engine.step(1);
    expect(engine.state.pressureRows).toBe(1);
    expect(participant.board.grid).toEqual(lockedGrid);
    expect(participant.board.spawnSerial).toBe(spawnSerial);
    engine.step(179);
    engine.step(clearFallDurationMs(1));
    expect(participant.board.grid.at(-1)?.every((cell) => cell === 'garbage')).toBe(true);
    expect(participant.board.spawnSerial).toBe(spawnSerial + 1);
  });

  it('waits for the landing commit before deciding a timed result', () => {
    const engine = new MatchEngine([
      { id: 'p1', label: 'Player 1', controller: 'human-1' },
      { id: 'p2', label: 'Player 2', controller: 'human-2' },
    ], 942, 2);
    engine.state.phase = 'playing';
    const participant = engine.state.participants[0]!;
    prepareClearPlaytest(participant.board, 'normal', 1);
    engine.step(FIXED_STEP_MS);
    engine.state.elapsedMs = engine.state.durationMs - 1;
    engine.step(1);
    expect(engine.state.phase).toBe('playing');
    expect(participant.score).toBe(0);
    engine.step(180);
    engine.step(clearFallDurationMs(1));
    expect(participant.score).toBe(100);
    expect(engine.state.phase).toBe('results');
    expect(engine.state.winnerIds).toEqual(['p1']);
  });
});
