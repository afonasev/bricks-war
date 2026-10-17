/** Presentation only: the authoritative highlight/fall durations stay unchanged. */
export function clearSweepProgress(remainingMs: number, durationMs: number): number {
  return durationMs <= 0 ? 1 : Math.max(0, Math.min(1, 1 - remainingMs / durationMs));
}

export function isClearCellVisible(column: number, columns: number, progress: number, reducedMotion = false): boolean {
  return reducedMotion || column >= Math.floor(Math.max(0, Math.min(1, progress)) * columns);
}
