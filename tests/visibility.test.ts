import { describe, expect, it } from 'vitest';
import { HumanInputRouter } from '../src/controllers/input';
import { applyDocumentVisibility } from '../src/controllers/visibility';
import { COUNTDOWN_MS } from '../src/simulation/match';
import { createFixture, humanPair } from './fixtures';

describe('document visibility lifecycle', () => {
  it('pauses simulation, clears input, and resumes without elapsed hidden time', () => {
    const engine = createFixture();
    const input = new HumanInputRouter();
    input.configure(humanPair());
    engine.step(COUNTDOWN_MS);
    input.setEnabled(true);
    input.handleKeyDown('KeyA');

    applyDocumentVisibility(true, engine, input);
    const elapsed = engine.state.elapsedMs;
    expect(engine.state.phase).toBe('paused');
    expect(engine.state.pauseReasons).toEqual(['hidden']);
    expect(input.drain().size).toBe(0);
    engine.step(5000);
    expect(engine.state.elapsedMs).toBe(elapsed);

    applyDocumentVisibility(false, engine, input);
    expect(engine.state.phase).toBe('playing');
    expect(engine.state.pauseReasons).toEqual([]);
  });

  it('does not clear an overlapping manual pause when the tab becomes visible', () => {
    const engine = createFixture();
    const input = new HumanInputRouter();
    input.configure(humanPair());
    engine.step(COUNTDOWN_MS);
    engine.pause('manual');
    applyDocumentVisibility(true, engine, input);
    expect(engine.state.pauseReasons).toEqual(['manual', 'hidden']);
    applyDocumentVisibility(false, engine, input);
    expect(engine.state.phase).toBe('paused');
    expect(engine.state.pauseReasons).toEqual(['manual']);
    engine.resume('manual');
    expect(engine.state.phase).toBe('playing');
  });
});
