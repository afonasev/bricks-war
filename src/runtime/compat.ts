export function fromEntries<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, value] of entries) result[key] = value;
  return result;
}
