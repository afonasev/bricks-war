import { describe, expect, it } from 'vitest';
import { MatchEngine, FIXED_STEP_MS, validateNetworkSurvivalParticipants } from '../src/simulation/match';
import { humanPair } from './fixtures';
import { prepareClearPlaytest } from '../src/ui/clearPlaytest';

function roundTrip(engine: MatchEngine): MatchEngine {
  return MatchEngine.restore(JSON.parse(JSON.stringify(engine.checkpoint())));
}
function continueBoth(engine: MatchEngine, restored: MatchEngine, steps = 500) {
  for (let tick = 0; tick < steps; tick++) {
    const actions = new Map([['p1', tick % 17 === 0 ? ['rotate-clockwise' as const] : tick % 7 === 0 ? ['move-left' as const] : []]]);
    engine.step(FIXED_STEP_MS, actions); restored.step(FIXED_STEP_MS, actions);
    expect(restored.checkpoint()).toEqual(engine.checkpoint());
  }
}
describe('complete engine checkpoint', () => {
  it.each([2, 3, 4])('rejects checkpoint version %s before the deferred shield impact contract', (version) => {
    const engine = new MatchEngine(humanPair(), 1);
    const old = { ...engine.checkpoint(), version };
    expect(() => MatchEngine.restore(old as unknown as ReturnType<MatchEngine['checkpoint']>)).toThrow('Unsupported checkpoint version');
  });
  it('round trips countdown, preparation, progression/anomaly, pressure and pause', () => {
    const engine = new MatchEngine(humanPair(), 9382, 5, {}, null, true);
    expect(engine.checkpoint().state.durationMs).toBeNull();
    continueBoth(engine, roundTrip(engine), 190);
    engine.state.participants[0]!.placedPieces = 9;
    engine.state.nextPressureAtMs = engine.state.elapsedMs + 100;
    continueBoth(engine, roundTrip(engine));
    engine.pause('manual'); engine.pause('hidden');
    const restored = roundTrip(engine);
    continueBoth(engine, restored, 10);
    engine.resume('manual'); restored.resume('manual');
    engine.resume('hidden'); restored.resume('hidden');
    continueBoth(engine, restored);
  });
  it.each(['normal', 'fire'] as const)('continues an actual deferred %s clear identically', (kind) => {
    const engine = new MatchEngine(humanPair(), 77, 5, {}, null, true);
    engine.step(3000);
    prepareClearPlaytest(engine.state.participants[0]!.board, kind, 2, 0);
    engine.step(FIXED_STEP_MS);
    expect(engine.state.clearPresentations.length).toBeGreaterThan(0);
    continueBoth(engine, roundTrip(engine));
  });
  it('isolates network validation from local mode/controller limits and retains all fields', () => {
    const configs = Array.from({length: 8}, (_, i) => ({id: `p${i}`, label: `Human ${i}`, controller: 'mobile-touch' as const}));
    expect(validateNetworkSurvivalParticipants(configs)).toEqual([]);
    expect(() => new MatchEngine(configs, 7, 5, {}, null, true)).toThrow();
    const network = new MatchEngine(configs, 7, 5, {}, null, true, 'network');
    continueBoth(network, roundTrip(network), 200);
    network.eliminate('p0'); expect(network.state.phase).toBe('playing');
    for (const p of configs) network.eliminate(p.id);
    expect(network.state.phase).toBe('results');
    expect(network.state.participants).toHaveLength(8);
    expect(() => new MatchEngine([...configs, configs[0]!], 7, 5, {}, null, true, 'network')).toThrow();
  });
});
