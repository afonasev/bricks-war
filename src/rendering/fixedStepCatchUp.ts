export const MAX_FIXED_STEPS_PER_RENDER = 4;

export interface FixedStepCatchUp {
  steps: number;
  remainingAccumulatorMs: number;
}

export function fixedStepCatchUp(
  accumulatorMs: number,
  fixedStepMs: number,
  maximumSteps = MAX_FIXED_STEPS_PER_RENDER,
): FixedStepCatchUp {
  const availableSteps = Math.max(0, Math.floor(accumulatorMs / fixedStepMs));
  const steps = Math.min(availableSteps, maximumSteps);
  return {
    steps,
    remainingAccumulatorMs: accumulatorMs - (steps * fixedStepMs),
  };
}
