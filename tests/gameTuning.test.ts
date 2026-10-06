import { describe, expect, it } from 'vitest';
import { difficultyProfile } from '../src/controllers/ai';
import { HumanInputRouter } from '../src/controllers/input';
import { cloneGameTuning, DEFAULT_GAME_TUNING, isGameTuningPayload, releaseTuningSaveEnabled } from '../src/domain/gameTuning';
import { MatchEngine } from '../src/simulation/match';
import { humanPair } from './fixtures';

describe('debug game-design tuning', () => {
  it('allows release-file promotion only on localhost development servers', () => {
    expect(releaseTuningSaveEnabled({ hostname: '127.0.0.1' } as Location)).toBe(true);
    expect(releaseTuningSaveEnabled({ hostname: 'localhost' } as Location)).toBe(true);
    expect(releaseTuningSaveEnabled({ hostname: 'game.example' } as Location)).toBe(false);
  });

  it('clones nested AI values without mutating the defaults', () => {
    const defaultErrorChance = DEFAULT_GAME_TUNING.ai.expert.errorChance;
    const tuning = cloneGameTuning();
    tuning.ai.expert.errorChance = defaultErrorChance === 0.5 ? 0.4 : 0.5;
    expect(DEFAULT_GAME_TUNING.ai.expert.errorChance).toBe(defaultErrorChance);
  });

  it('accepts the current release payload and rejects an incomplete one', () => {
    const tuning = cloneGameTuning();
    expect(isGameTuningPayload(tuning)).toBe(true);
    expect(DEFAULT_GAME_TUNING.conflictWarningMs).toBe(3_000);
    expect(DEFAULT_GAME_TUNING.spawnPreparationMs).toBe(400);
    expect(DEFAULT_GAME_TUNING.spawnRotationExtensionMs).toBe(200);
    expect(DEFAULT_GAME_TUNING.spawnPreparationMaxMs).toBe(1_000);
    delete (tuning as Partial<typeof tuning>).conflictWarningMs;
    expect(isGameTuningPayload(tuning)).toBe(false);
  });

  it('rejects a preparation cap below its base duration', () => {
    const tuning = cloneGameTuning();
    tuning.spawnPreparationMaxMs = tuning.spawnPreparationMs - 1;
    expect(isGameTuningPayload(tuning)).toBe(false);
  });

  it('applies direct movement, progression, and pressure values to a match', () => {
    const tuning = cloneGameTuning();
    tuning.battleDifficulties.normal.startingGravityMs = 640;
    tuning.battleDifficulties.normal.accelerationPercent = 20;
    tuning.minimumGravityMs = 90;
    tuning.softDropIntervalMs = 70;
    tuning.pressurePhasePercent = 40;
    tuning.pressureIntervalMs = 5_000;
    tuning.battleDifficulties.normal.piecesPerLevel = 4;
    const engine = new MatchEngine(humanPair(), 77, 2, {}, tuning);
    expect(engine.state.countdownMs).toBe(3_000);
    expect(engine.state.gravityIntervalMs).toBe(640);
    expect(engine.state.pressureStartMs).toBe(72_000);
    expect(engine.state.nextPressureAtMs).toBe(77_000);
    expect(engine.state.options.softDropIntervalMs).toBe(70);
    expect(engine.state.options.piecesPerLevel).toBe(4);
  });

  it('applies custom horizontal repeat and AI values', () => {
    const router = new HumanInputRouter(30, 20);
    router.configure([{ id: 'p1', label: 'P1', controller: 'human-1' }]);
    router.setEnabled(true);
    router.handleKeyDown('KeyA');
    router.drain();
    router.step(29);
    expect(router.drain().get('p1')).toBeUndefined();
    router.step(1);
    expect(router.drain().get('p1')).toEqual(['move-left']);

    const tuning = cloneGameTuning();
    tuning.ai.expert.reactionMs = 40;
    tuning.ai.expert.errorChance = 0.12;
    expect(difficultyProfile('expert', tuning)).toMatchObject({ reactionMs: 40, errorChance: 0.12 });
  });
});
