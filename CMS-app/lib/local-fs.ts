/**
 * Local filesystem backend for development.
 * Reads/writes content files directly from disk instead of GitHub API.
 *
 * The core functions are addressed by a CMS-content-relative *subpath* (e.g.
 * `shared/snippets/x.mdx` or `projects/accelerate/toc.json`). The app-path
 * wrappers (`getFile`, …) map `content/<rel>` → subpath via content-paths and
 * delegate. The storage layer resolves per-project overrides and calls the
 * `*At` functions directly with the already-resolved physical subpath.
 */

import * as fs from "fs";
import * as path from "path";
import type { GitHubFile } from "./types";
import { contentSubpathFromApp, subpathToContent } from "./content-paths";

const CONTENT_ROOT = path.resolve(process.cwd(), "..", "CMS-content");

/** Map an app `content/<rel>` path to its sub-path under CMS-content/. */
function diskSubpath(appPath: string): string {
  return contentSubpathFromApp(appPath);
}

function ensureContentDir() {
  if (!fs.existsSync(CONTENT_ROOT)) {
    fs.mkdirSync(CONTENT_ROOT, { recursive: true });
  }
}

// ── Subpath-addressed core (CMS-content-relative) ──

export async function existsAt(sub: string): Promise<boolean> {
  return fs.existsSync(path.join(CONTENT_ROOT, sub));
}

export async function getFileAt(sub: string): Promise<GitHubFile> {
  const fullPath = path.join(CONTENT_ROOT, sub);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  const content = fs.readFileSync(fullPath, "utf-8");
  return { path: subpathToContent(sub), content, sha: "", encoding: "utf-8" };
}

export async function putFileAt(
  sub: string,
  content: string
): Promise<{ sha: string; commitSha: string }> {
  ensureContentDir();
  const fullPath = path.join(CONTENT_ROOT, sub);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, content, "utf-8");
  return { sha: "", commitSha: "" };
}

export async function deleteFileAt(sub: string): Promise<void> {
  const fullPath = path.join(CONTENT_ROOT, sub);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

/** Byte-exact copy (binary-safe — no utf-8 round-trip). */
export async function copyFileAt(fromSub: string, toSub: string): Promise<void> {
  ensureContentDir();
  const from = path.join(CONTENT_ROOT, fromSub);
  const to = path.join(CONTENT_ROOT, toSub);
  const dir = path.dirname(to);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(from, to);
}

export async function listFilesAt(sub: string): Promise<string[]> {
  const fullPath = path.join(CONTENT_ROOT, sub);
  if (!fs.existsSync(fullPath)) return [];
  return fs.readdirSync(fullPath).map((f) => subpathToContent(`${sub}/${f}`));
}

export async function listFilesRecursiveAt(sub: string): Promise<string[]> {
  const fullPath = path.join(CONTENT_ROOT, sub);
  if (!fs.existsSync(fullPath)) return [];
  const results: string[] = [];
  function walk(dir: string, relSub: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const childSub = `${relSub}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), childSub);
      } else {
        results.push(subpathToContent(childSub));
      }
    }
  }
  walk(fullPath, sub);
  return results;
}

// ── App-path wrappers (content/<rel>) — delegate through the path mapper ──

export async function getFile(filePath: string): Promise<GitHubFile> {
  return getFileAt(diskSubpath(filePath));
}

export async function putFile(
  filePath: string,
  content: string
): Promise<{ sha: string; commitSha: string }> {
  return putFileAt(diskSubpath(filePath), content);
}

export async function deleteFile(filePath: string): Promise<void> {
  return deleteFileAt(diskSubpath(filePath));
}

export async function listFiles(dirPath: string): Promise<string[]> {
  return listFilesAt(diskSubpath(dirPath));
}

export async function listFilesRecursive(dirPath: string): Promise<string[]> {
  return listFilesRecursiveAt(diskSubpath(dirPath));
}
