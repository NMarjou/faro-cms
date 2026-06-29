/**
 * Storage abstraction: uses local filesystem in dev, GitHub API in production.
 *
 * This layer is the sole place that turns an app `content/<rel>` path into a
 * *physical* CMS-content subpath, because for override-capable shared assets
 * (snippets — see content-paths.OVERRIDABLE_DIRS) that mapping is async: a path
 * resolves to `projects/<slug>/<rel>` when a project-local override exists, else
 * `shared/<rel>`. The backends expose subpath-addressed `*At` functions; we
 * resolve here and hand them the physical subpath.
 */

import * as github from "./github";
import * as localFs from "./local-fs";
import type { GitHubFile } from "./types";
import { memoize, invalidate, invalidatePrefix } from "./cache";
import {
  contentSubpathFromApp,
  isOverridable,
  sharedSubpath,
  projectSubpath,
} from "./content-paths";

const isLocal = !process.env.GITHUB_TOKEN;

// Key the file cache on the resolved physical subpath, not the app path —
// otherwise the same `content/...` app path collides across projects (and
// across shared vs project-override), serving one project's read to another.
const FILE_KEY = (sub: string) => `file:${sub}`;
const FILE_TTL_MS = 60_000;

export const SNIPPETS_LIST_PREFIX = "snippets:list:";

// ── Backend dispatch on a physical (CMS-content-relative) subpath ──

function existsAtSub(sub: string): Promise<boolean> {
  return isLocal ? localFs.existsAt(sub) : github.existsAt(sub);
}
function getFileAtSub(sub: string, ref?: string): Promise<GitHubFile> {
  return isLocal ? localFs.getFileAt(sub) : github.getFileAt(sub, ref);
}
function putFileAtSub(
  sub: string,
  content: string,
  message: string,
  branch?: string,
  sha?: string
): Promise<{ sha: string; commitSha: string }> {
  return isLocal
    ? localFs.putFileAt(sub, content)
    : github.putFileAt(sub, content, message, branch, sha);
}
function deleteFileAtSub(sub: string, message: string, branch?: string): Promise<void> {
  return isLocal ? localFs.deleteFileAt(sub) : github.deleteFileAt(sub, message, branch);
}
function listAtSub(sub: string): Promise<string[]> {
  return isLocal ? localFs.listFilesAt(sub) : github.listFilesAt(sub);
}
function listRecursiveAtSub(sub: string): Promise<string[]> {
  return isLocal ? localFs.listFilesRecursiveAt(sub) : github.listFilesRecursiveAt(sub);
}

/** Strip a leading `content/` app prefix. */
function stripContentPrefix(appPath: string): string {
  return appPath.startsWith("content/") ? appPath.slice("content/".length) : appPath;
}

/**
 * Physical subpath an app path resolves to. For override-capable assets the
 * project-local copy wins when it exists, else shared. Read and write resolve
 * identically: a write lands on the override iff it already exists, otherwise
 * shared (so new/shared edits keep their cross-project blast radius, and
 * forking is the explicit `makeProjectSpecific` step).
 */
async function resolveSubpath(appPath: string): Promise<string> {
  const rel = stripContentPrefix(appPath);
  if (!isOverridable(rel)) return contentSubpathFromApp(appPath);
  const proj = projectSubpath(rel);
  return (await existsAtSub(proj)) ? proj : sharedSubpath(rel);
}

// ── File reads ──

export async function getFile(path: string, ref?: string): Promise<GitHubFile> {
  return getFileAtSub(await resolveSubpath(path), ref);
}

/**
 * Cached read for slowly-changing files. Bypasses cache when a specific
 * `ref` is requested. Writes via `putFile`/`deleteFile` invalidate.
 */
export async function getCachedFile(path: string, ref?: string): Promise<GitHubFile> {
  if (ref) return getFile(path, ref);
  const sub = await resolveSubpath(path);
  return memoize(FILE_KEY(sub), () => getFileAtSub(sub), FILE_TTL_MS);
}

/** Invalidate every cache key a write to this app path could have touched. */
export function invalidateFileCache(path: string): void {
  const rel = stripContentPrefix(path);
  if (isOverridable(rel)) {
    // The write could have landed on either the shared copy or the project
    // override; both keys (this project's) may now be stale.
    invalidate(FILE_KEY(sharedSubpath(rel)));
    invalidate(FILE_KEY(projectSubpath(rel)));
  } else {
    invalidate(FILE_KEY(contentSubpathFromApp(path)));
  }
  if (rel === "snippets" || rel.startsWith("snippets/")) {
    invalidatePrefix(SNIPPETS_LIST_PREFIX);
  }
}

// ── File writes ──

export async function putFile(
  path: string,
  content: string,
  message: string,
  branch?: string,
  sha?: string
): Promise<{ sha: string; commitSha: string }> {
  invalidateFileCache(path);
  return putFileAtSub(await resolveSubpath(path), content, message, branch, sha);
}

export async function deleteFile(
  path: string,
  message: string,
  branch?: string
): Promise<void> {
  invalidateFileCache(path);
  return deleteFileAtSub(await resolveSubpath(path), message, branch);
}

// ── Directory listings (override-aware union for overridable dirs) ──

export async function listFiles(path: string, ref?: string): Promise<string[]> {
  const rel = stripContentPrefix(path);
  if (isOverridable(rel)) return mergedList(rel, listAtSub);
  if (isLocal) return localFs.listFilesAt(contentSubpathFromApp(path));
  return github.listFilesAt(contentSubpathFromApp(path), ref);
}

export async function listFilesRecursive(path: string, ref?: string): Promise<string[]> {
  const rel = stripContentPrefix(path);
  if (isOverridable(rel)) return mergedList(rel, listRecursiveAtSub);
  if (isLocal) return localFs.listFilesRecursiveAt(contentSubpathFromApp(path));
  return github.listFilesRecursiveAt(contentSubpathFromApp(path), ref);
}

/** Union of shared + project-local listings (project shadows shared), as app paths. */
async function mergedList(
  rel: string,
  lister: (sub: string) => Promise<string[]>
): Promise<string[]> {
  const [shared, proj] = await Promise.all([
    lister(sharedSubpath(rel)),
    lister(projectSubpath(rel)),
  ]);
  return [...new Set([...shared, ...proj])];
}

// ── Per-project override of shared assets ──

export type AssetScope = "shared" | "project";

/**
 * Merged listing of an overridable dir with each entry's origin. Both backends
 * map their physical paths back to the same app `content/<rel>` path, so a
 * project override and its shared twin collide on one key — the project wins.
 */
export async function listOverridable(
  appDir: string
): Promise<{ file: string; scope: AssetScope }[]> {
  const rel = stripContentPrefix(appDir);
  const [shared, proj] = await Promise.all([
    listRecursiveAtSub(sharedSubpath(rel)),
    listRecursiveAtSub(projectSubpath(rel)),
  ]);
  const byApp = new Map<string, AssetScope>();
  for (const f of shared) byApp.set(f, "shared");
  for (const f of proj) byApp.set(f, "project"); // override shadows shared
  return [...byApp].map(([file, scope]) => ({ file, scope }));
}

/** Whether the current project has a local override of this content-relative path. */
export function hasProjectOverride(rel: string): Promise<boolean> {
  return existsAtSub(projectSubpath(rel));
}

/** Fork the shared copy of `rel` into the current project ("Make project-specific"). */
export async function makeProjectSpecific(
  rel: string
): Promise<{ sha: string; commitSha: string }> {
  const shared = await getFileAtSub(sharedSubpath(rel));
  const result = await putFileAtSub(
    projectSubpath(rel),
    shared.content,
    `Make project-specific: ${rel}`
  );
  invalidateFileCache(`content/${rel}`);
  return result;
}

/** Remove the current project's override of `rel`, restoring the shared copy. */
export async function revertToShared(rel: string): Promise<void> {
  await deleteFileAtSub(projectSubpath(rel), `Revert to shared: ${rel}`);
  invalidateFileCache(`content/${rel}`);
}

export { isLocal };
