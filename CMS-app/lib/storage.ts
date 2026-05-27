/**
 * Storage abstraction: uses local filesystem in dev, GitHub API in production.
 */

import * as github from "./github";
import * as localFs from "./local-fs";
import type { GitHubFile } from "./types";
import { memoize, invalidate, invalidatePrefix } from "./cache";

const isLocal = !process.env.GITHUB_TOKEN;

const FILE_KEY = (path: string) => `file:${path}`;
const FILE_TTL_MS = 60_000;

export const SNIPPETS_LIST_PREFIX = "snippets:list:";

export async function getFile(
  path: string,
  ref?: string
): Promise<GitHubFile> {
  if (isLocal) return localFs.getFile(path);
  return github.getFile(path, ref);
}

/**
 * Cached read for slowly-changing files. Bypasses cache when a specific
 * `ref` is requested. Writes via `putFile`/`deleteFile` invalidate.
 */
export async function getCachedFile(
  path: string,
  ref?: string
): Promise<GitHubFile> {
  if (ref) return getFile(path, ref);
  return memoize(FILE_KEY(path), () => getFile(path), FILE_TTL_MS);
}

export function invalidateFileCache(path: string): void {
  invalidate(FILE_KEY(path));
  if (path.startsWith("content/snippets/")) {
    invalidatePrefix(SNIPPETS_LIST_PREFIX);
  }
}

export async function putFile(
  path: string,
  content: string,
  message: string,
  branch?: string,
  sha?: string
): Promise<{ sha: string; commitSha: string }> {
  invalidateFileCache(path);
  if (isLocal) return localFs.putFile(path, content);
  return github.putFile(path, content, message, branch, sha);
}

export async function deleteFile(
  path: string,
  message: string,
  branch?: string
): Promise<void> {
  invalidateFileCache(path);
  if (isLocal) return localFs.deleteFile(path);
  return github.deleteFile(path, message, branch);
}

export async function listFiles(
  path: string,
  ref?: string
): Promise<string[]> {
  if (isLocal) return localFs.listFiles(path);
  return github.listFiles(path, ref);
}

export async function listFilesRecursive(
  path: string,
  ref?: string
): Promise<string[]> {
  if (isLocal) return localFs.listFilesRecursive(path);
  // GitHub getTree already returns recursive results. Translate the incoming
  // app-shaped path (content/...) to the repo-shaped prefix (CMS-content/...)
  // before filtering, then map matched tree paths back to app shape.
  const tree = await github.getTree(ref);
  const repoPrefix = github.toRepoPath(path);
  return tree
    .filter((item) => item.type === "blob" && item.path.startsWith(repoPrefix))
    .map((item) => github.fromRepoPath(item.path));
}

export { isLocal };
