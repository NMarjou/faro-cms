import { Octokit } from "octokit";
import type { GitHubFile, GitHubTreeItem } from "./types";

// Content in the GitHub repo lives under CMS-content/, but the app addresses
// it as content/. Map between the two at the octokit boundary so callers
// (and the local-fs backend) can share a single path shape.
export const REPO_CONTENT_PREFIX = "CMS-content/";
const APP_CONTENT_PREFIX = "content/";

export function toRepoPath(appPath: string): string {
  return appPath.startsWith(APP_CONTENT_PREFIX)
    ? REPO_CONTENT_PREFIX + appPath.slice(APP_CONTENT_PREFIX.length)
    : appPath;
}

export function fromRepoPath(repoPath: string): string {
  return repoPath.startsWith(REPO_CONTENT_PREFIX)
    ? APP_CONTENT_PREFIX + repoPath.slice(REPO_CONTENT_PREFIX.length)
    : repoPath;
}

function getOctokit() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  return new Octokit({ auth: token });
}

function getRepo() {
  const repo = process.env.GITHUB_REPO;
  if (!repo) throw new Error("GITHUB_REPO is not set");
  const [owner, name] = repo.split("/");
  return { owner, repo: name };
}

export function defaultBranch(): string {
  return process.env.GITHUB_DEFAULT_BRANCH || "main";
}

// The branch all editor saves target when the caller doesn't specify one.
// Falls back to defaultBranch() if CMS_WORKING_BRANCH is unset, so behavior
// is unchanged for installs that haven't opted in to the guardrail.
export function workingBranch(): string {
  return process.env.CMS_WORKING_BRANCH || defaultBranch();
}

let workingBranchEnsured = false;
let ensurePromise: Promise<void> | null = null;

// Make sure the working branch exists on the remote (forked from defaultBranch
// if missing). Cheap after the first call per process: a single branchExists
// round-trip, then a short-circuit. If working === default, nothing to do.
//
// Concurrent callers share a single in-flight promise so we don't race on
// branchExists/createBranch — a single request that triggers several parallel
// getFile/putFile calls (e.g. the review-done gate's 3 parallel sidecar
// reads) would otherwise issue several createBranch attempts and the
// trailing ones would hit GitHub's "Reference already exists" (422).
export function ensureWorkingBranch(): Promise<void> {
  if (workingBranchEnsured) return Promise.resolve();
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const wb = workingBranch();
    if (wb === defaultBranch()) {
      workingBranchEnsured = true;
      return;
    }
    const exists = await branchExists(wb);
    if (!exists) {
      try {
        await createBranch(wb);
      } catch (err) {
        // 422 here means a parallel caller (or a previous failed attempt
        // whose flag didn't latch) already created the branch. Safe to
        // treat as success.
        const status = (err as { status?: number })?.status;
        if (status !== 422) throw err;
      }
    }
    workingBranchEnsured = true;
  })().finally(() => {
    ensurePromise = null;
  });
  return ensurePromise;
}

// ── Read operations ──

export async function getFile(
  path: string,
  ref?: string
): Promise<GitHubFile> {
  if (!ref) await ensureWorkingBranch();
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: toRepoPath(path),
    ref: ref || workingBranch(),
  });
  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`Path ${path} is not a file`);
  }
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { path: fromRepoPath(data.path), content, sha: data.sha, encoding: "utf-8" };
}

export async function listFiles(path: string, ref?: string): Promise<string[]> {
  if (!ref) await ensureWorkingBranch();
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: toRepoPath(path),
    ref: ref || workingBranch(),
  });
  if (!Array.isArray(data)) {
    throw new Error(`Path ${path} is not a directory`);
  }
  return data.map((item: { path: string }) => fromRepoPath(item.path));
}

export async function getTree(ref?: string): Promise<GitHubTreeItem[]> {
  if (!ref) await ensureWorkingBranch();
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: ref || workingBranch(),
    recursive: "true",
  });
  return data.tree as GitHubTreeItem[];
}

// ── Write operations ──

export async function putFile(
  path: string,
  content: string,
  message: string,
  branch?: string,
  sha?: string
): Promise<{ sha: string; commitSha: string }> {
  if (!branch) await ensureWorkingBranch();
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  // If no SHA provided, try to get existing file's SHA
  let fileSha = sha;
  if (!fileSha) {
    try {
      const existing = await getFile(path, branch || workingBranch());
      fileSha = existing.sha;
    } catch {
      // File doesn't exist yet, that's fine
    }
  }

  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: toRepoPath(path),
    message,
    content: Buffer.from(content).toString("base64"),
    branch: branch || workingBranch(),
    ...(fileSha ? { sha: fileSha } : {}),
  });

  return {
    sha: data.content?.sha || "",
    commitSha: data.commit.sha || "",
  };
}

export async function deleteFile(
  path: string,
  message: string,
  branch?: string
): Promise<void> {
  if (!branch) await ensureWorkingBranch();
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const file = await getFile(path, branch || workingBranch());
  await octokit.rest.repos.deleteFile({
    owner,
    repo,
    path: toRepoPath(path),
    message,
    sha: file.sha,
    branch: branch || workingBranch(),
  });
}

// ── Branch & PR operations ──

export async function createBranch(
  name: string,
  fromRef?: string
): Promise<string> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  // Get the SHA of the source branch
  const { data: refData } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${fromRef || defaultBranch()}`,
  });

  // Create new branch
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${name}`,
    sha: refData.object.sha,
  });

  return name;
}

export async function createPR(
  title: string,
  body: string,
  headBranch: string,
  baseBranch?: string
): Promise<{ url: string; number: number }> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head: headBranch,
    base: baseBranch || defaultBranch(),
  });

  return { url: data.html_url, number: data.number };
}

/** Repo paths (CMS-content/…) of every file changed in a pull request. */
export async function getPullFiles(prNumber: number): Promise<string[]> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  return files.map((f) => f.filename);
}

export async function branchExists(name: string): Promise<boolean> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  try {
    await octokit.rest.git.getRef({ owner, repo, ref: `heads/${name}` });
    return true;
  } catch {
    return false;
  }
}
