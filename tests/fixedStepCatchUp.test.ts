import { describe, expect, it } from 'vitest';
import { fixedStepCatchUp, MAX_FIXED_STEPS_PER_RENDER } from '../src/rendering/fixedStepCatchUp';

describe('fixed-step catch-up', () => {
  const fixedStepMs = 1000 / 60;

  it('does not schedule a step when the accumulator is empty or partial', () => {
    expect(fixedStepCatchUp(0, fixedStepMs)).toEqual({ steps: 0, remainingAccumulatorMs: 0 });
    const partial = fixedStepCatchUp(fixedStepMs / 2, fixedStepMs);
    expect(partial.steps).toBe(0);
    expect(partial.remainingAccumulatorMs).toBeCloseTo(fixedStepMs / 2);
  });

  it('consumes exactly an at-budget batch', () => {
    const catchUp = fixedStepCatchUp(MAX_FIXED_STEPS_PER_RENDER * fixedStepMs, fixedStepMs);
    expect(catchUp.steps).toBe(MAX_FIXED_STEPS_PER_RENDER);
    expect(catchUp.remainingAccumulatorMs).toBeCloseTo(0);
  });

  it('defers over-budget steps while retaining their valid elapsed time', () => {
    const pendingSteps = MAX_FIXED_STEPS_PER_RENDER + 2.5;
    const catchUp = fixedStepCatchUp(pendingSteps * fixedStepMs, fixedStepMs);
    expect(catchUp.steps).toBe(MAX_FIXED_STEPS_PER_RENDER);
    expect(catchUp.remainingAccumulatorMs).toBeCloseTo(2.5 * fixedStepMs);
  });

  it('executes the localhost accelerated fixture without discarding gameplay steps', () => {
    const scale = 20;
    const elapsed = fixedStepMs * scale;
    const catchUp = fixedStepCatchUp(elapsed, fixedStepMs, MAX_FIXED_STEPS_PER_RENDER * scale);
    expect(catchUp.steps).toBe(scale);
    expect(catchUp.remainingAccumulatorMs).toBeCloseTo(0);
    expect(fixedStepCatchUp(elapsed, fixedStepMs).steps).toBe(MAX_FIXED_STEPS_PER_RENDER);
  });

  it('bounds the existing 250 ms elapsed-time cap to one render batch', () => {
    const catchUp = fixedStepCatchUp(250, fixedStepMs);
    expect(catchUp.steps).toBe(MAX_FIXED_STEPS_PER_RENDER);
    expect(catchUp.remainingAccumulatorMs).toBeGreaterThan(fixedStepMs);
  });
});
