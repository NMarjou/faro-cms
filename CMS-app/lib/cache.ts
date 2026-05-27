/**
 * Per-process in-memory TTL cache for slowly-changing reads.
 * Resets on server restart. Use for metadata that rarely changes
 * (TOC, variables, glossary, snippet listing).
 */

type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();

export async function memoize<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = 60_000
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export function invalidate(key: string): void {
  store.delete(key);
}

export function invalidatePrefix(prefix: string): void {
  for (const k of Array.from(store.keys())) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
