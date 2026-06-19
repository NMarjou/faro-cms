/**
 * Concurrency-safe read-modify-write for sidecar JSON (comments, suggestions).
 *
 * Whole-file JSON sidecars are read, mutated, and written back. Without a guard,
 * two concurrent writers each read the same version and the second overwrites
 * the first. `mutateJsonFile` reads the current content with its sha, applies
 * the mutation, and writes back keyed on that sha — so a stale write is
 * rejected by GitHub (409/422) and retried against fresh content, merging
 * instead of clobbering. Local FS has no sha/concurrency, so it's one pass.
 */

import { getFile, putFile } from "./storage";

const MAX_ATTEMPTS = 4;

export async function mutateJsonFile<T>(
  path: string,
  mutate: (current: T | null) => T,
  message: string
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let current: T | null = null;
    let sha: string | undefined;
    try {
      const file = await getFile(path);
      current = JSON.parse(file.content) as T;
      sha = file.sha || undefined;
    } catch {
      // File doesn't exist yet — create it on write.
      current = null;
      sha = undefined;
    }

    const next = mutate(current);

    try {
      await putFile(path, JSON.stringify(next, null, 2), message, undefined, sha);
      return next;
    } catch (err) {
      // A stale sha means a concurrent write landed first — re-read and retry.
      const status = (err as { status?: number }).status;
      if ((status === 409 || status === 422) && attempt < MAX_ATTEMPTS - 1) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(`Failed to update ${path} after ${MAX_ATTEMPTS} attempts`);
}
