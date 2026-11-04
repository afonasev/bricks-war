/** Presentation metadata only; never participates in update eligibility or activation. */
export function normalizeReleaseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time).toISOString().slice(0, 10);
  return date === value.slice(0, 10) ? date : null;
}
export function manifestReleaseDate(manifest) {
  const explicit = normalizeReleaseDate(manifest?.releaseDate);
  if (explicit) return explicit;
  // Historical signed content sequences were generated with Date.now(). Small
  // synthetic counters and out-of-range values are not meaningful calendar dates.
  const sequence = manifest?.sequence;
  return Number.isSafeInteger(sequence) && sequence >= 946684800000 && sequence < 4102444800000
    ? new Date(sequence).toISOString().slice(0, 10) : null;
}
