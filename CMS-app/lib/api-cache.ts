/**
 * Cache headers for authoring data.
 *
 * These endpoints serve MUTABLE data that the app both reads and writes (the
 * TOC, variables, glossary, styles, conditions, snippets, file content). They
 * used to send `private, max-age=60, stale-while-revalidate=300`, which is
 * actively harmful here, because there are two caches and only one of them can
 * be invalidated:
 *
 *   • the SERVER memo (`getCachedFile` / `memoize`) — invalidated on every write
 *     via `invalidateFileCache`, so it's always correct;
 *   • the BROWSER cache — cannot be invalidated from the server at all.
 *
 * So the browser cache could only ever serve stale authoring data. It did: an
 * editor would PUT a change, refetch to confirm, get its own pre-save response
 * back from cache, and overwrite the screen with it — the user saw "Saved" and
 * then watched their change vanish (proved on /styles: server had 1 override,
 * the UI said 0). Same class as the other "UI lies about what's stored" bugs.
 *
 * Dropping the browser cache costs little: the server memo still absorbs the
 * filesystem/GitHub reads, so a re-request is answered from memory — and unlike
 * the browser, it's correct after a write.
 *
 * (Raw binary responses — e.g. image bytes via /api/content?raw=1 — keep their
 * own cache header: they're assets, not authoring state.)
 */
export const NO_STORE = {
  "Cache-Control": "no-store",
} as const;
