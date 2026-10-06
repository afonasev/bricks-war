import type { GamepadControls } from './gamepads';

export interface TiltTuning { horizontalThreshold: number; rotateThreshold: number; dropThreshold: number; deadZone: number; smoothing: number; rotateRearmMs: number; }
export const DEFAULT_TILT_TUNING: TiltTuning = { horizontalThreshold: 14, rotateThreshold: 18, dropThreshold: 18, deadZone: 6, smoothing: 0.28, rotateRearmMs: 280 };
export function withTiltSensitivity(tuning: TiltTuning, sensitivity: number): TiltTuning {
  const multiplier = Math.min(1, Math.max(0.25, sensitivity));
  return { ...tuning, horizontalThreshold: tuning.horizontalThreshold / multiplier, rotateThreshold: Math.min(tuning.rotateThreshold / multiplier, 10), dropThreshold: Math.min(tuning.dropThreshold / multiplier, 10) };
}
export class TiltControls {
  private neutral: { beta: number; gamma: number } | null = null;
  private smoothBeta = 0; private smoothGamma = 0; private rotateArmed = true; private rotateElapsed = 0;
  private lastPosition: { beta: number; gamma: number } | null = null;
  private stableElapsed = 0;
  calibrate(event: Pick<DeviceOrientationEvent, 'beta' | 'gamma'>): void {
    this.neutral = { beta: event.beta ?? 0, gamma: event.gamma ?? 0 };
    this.lastPosition = { ...this.neutral };
    this.smoothBeta = 0; this.smoothGamma = 0; this.rotateArmed = true; this.stableElapsed = 0;
  }
  update(event: Pick<DeviceOrientationEvent, 'beta' | 'gamma'> | null, deltaMs: number, tuning: TiltTuning = DEFAULT_TILT_TUNING): GamepadControls | null {
    if (!event || !this.neutral) return null;
    const position = { beta: event.beta ?? this.neutral.beta, gamma: event.gamma ?? this.neutral.gamma };
    const beta = position.beta - this.neutral.beta;
    const gamma = position.gamma - this.neutral.gamma;
    const lastPosition = this.lastPosition ?? position;
    const stationary = Math.abs(position.beta - lastPosition.beta) <= 0.8 && Math.abs(position.gamma - lastPosition.gamma) <= 0.8;
    const insideNeutralZone = Math.abs(beta) <= tuning.deadZone && Math.abs(gamma) <= tuning.deadZone;
    this.stableElapsed = stationary && insideNeutralZone ? this.stableElapsed + deltaMs : 0;
    this.lastPosition = position;
    if (this.stableElapsed >= 750) { this.calibrate(position); return { left: false, right: false, down: false, rotate: false }; }
    this.rotateElapsed += deltaMs;
    this.smoothBeta += (beta - this.smoothBeta) * tuning.smoothing;
    this.smoothGamma += (gamma - this.smoothGamma) * tuning.smoothing;
    const neutral = Math.abs(this.smoothBeta) <= tuning.deadZone;
    if (neutral && this.rotateElapsed >= tuning.rotateRearmMs) this.rotateArmed = true;
    const rotate = this.rotateArmed && this.smoothBeta <= -tuning.rotateThreshold;
    if (rotate) { this.rotateArmed = false; this.rotateElapsed = 0; }
    return { left: this.smoothGamma <= -tuning.horizontalThreshold, right: this.smoothGamma >= tuning.horizontalThreshold, down: this.smoothBeta >= tuning.dropThreshold, rotate };
  }
}
