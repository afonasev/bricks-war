const DEAD_ZONE = 0.18;
const MAX_SPEED = 900; // CSS pixels per second at full stick deflection.

/** Per-frame direct scrolling avoids restarting a browser smooth-scroll animation. */
export function historyScrollDelta(vertical: number, elapsedMs: number): number {
  if (!Number.isFinite(vertical) || !Number.isFinite(elapsedMs) || Math.abs(vertical) <= DEAD_ZONE) return 0;
  const strength = (Math.min(1, Math.abs(vertical)) - DEAD_ZONE) / (1 - DEAD_ZONE);
  return Math.sign(vertical) * strength * MAX_SPEED * Math.max(0, Math.min(50, elapsedMs)) / 1000;
}
