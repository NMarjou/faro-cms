/**
 * Local filesystem backend for development.
 * Reads/writes content files directly from disk instead of GitHub API.
 */

import * as fs from "fs";
import * as path from "path";
import type { GitHubFile } from "./types";

const CONTENT_ROOT = path.resolve(process.cwd(), "..", "CMS-content");

function ensureContentDir() {
  if (!fs.existsSync(CONTENT_ROOT)) {
    fs.mkdirSync(CONTENT_ROOT, { recursive: true });
  }
}

export async function getFile(filePath: string): Promise<GitHubFile> {
  const fullPath = path.join(CONTENT_ROOT, filePath.replace(/^content\//, ""));
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  const content = fs.readFileSync(fullPath, "utf-8");
  return {
    path: filePath,
    content,
    sha: "",
    encoding: "utf-8",
  };
}

export async function putFile(
  filePath: string,
  content: string
): Promise<{ sha: string; commitSha: string }> {
  ensureContentDir();
  const fullPath = path.join(CONTENT_ROOT, filePath.replace(/^content\//, ""));
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, content, "utf-8");
  return { sha: "", commitSha: "" };
}

export async function deleteFile(filePath: string): Promise<void> {
  const fullPath = path.join(CONTENT_ROOT, filePath.replace(/^content\//, ""));
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

export async function listFiles(dirPath: string): Promise<string[]> {
  const fullPath = path.join(CONTENT_ROOT, dirPath.replace(/^content\//, ""));
  if (!fs.existsSync(fullPath)) return [];
  return fs
    .readdirSync(fullPath)
    .map((f) => path.join(dirPath, f));
}

export async function listFilesRecursive(dirPath: string): Promise<string[]> {
  const fullPath = path.join(CONTENT_ROOT, dirPath.replace(/^content\//, ""));
  if (!fs.existsSync(fullPath)) return [];
  const results: string[] = [];
  function walk(dir: string, relDir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = path.join(relDir, entry.name);
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else {
        results.push(rel);
      }
    }
  }
  walk(fullPath, dirPath);
  return results;
}
