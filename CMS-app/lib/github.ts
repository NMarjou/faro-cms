import { Octokit } from "octokit";
import type { GitHubFile, GitHubTreeItem } from "./types";
import { contentSubpathFromApp, subpathToContent } from "./content-paths";
import { getCurrentWorkingBranch, getCurrentBaseBranch } from "./request-context";
import { memoize, invalidatePrefix } from "./cache";

// Content in the GitHub repo lives under CMS-content/, but the app addresses
// it as content/. Within CMS-content the layout is split into shared/ and
// projects/<slug>/ — lib/content-paths.ts owns that rooting, so callers keep
// using flat `content/...` app paths and the translation happens only here.
export const REPO_CONTENT_PREFIX = "CMS-content/";
const APP_CONTENT_PREFIX = "content/";

export function toRepoPath(appPath: string): string {
  if (!appPath.startsWith(APP_CONTENT_PREFIX)) return appPath;
  return REPO_CONTENT_PREFIX + contentSubpathFromApp(appPath);
}

export function fromRepoPath(repoPath: string): string {
  if (!repoPath.startsWith(REPO_CONTENT_PREFIX)) return repoPath;
  return subpathToContent(repoPath.slice(REPO_CONTENT_PREFIX.length));
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

// The canonical/global default branch (env). The per-project base branch falls
// back to this when a project has no publishTarget.baseBranch.
export function defaultBranch(): string {
  return process.env.GITHUB_DEFAULT_BRANCH || "main";
}

// The branch editor saves target when the caller doesn't specify one — now the
// CURRENT project's working (draft) branch, resolved into the request context
// from its publishTarget (env fallback outside a request / when unset).
export function workingBranch(): string {
  return getCurrentWorkingBranch();
}

// The current project's base (publish) branch — where per-article publish PRs
// land. Falls back to defaultBranch() when the project has no publishTarget.
export function baseBranch(): string {
  return getCurrentBaseBranch();
}

// Per-branch memoization: with per-project working/base branches there are now
// several branches to ensure over a process's life, not one.
const ensuredBranches = new Set<string>();
const ensureInFlight = new Map<string, Promise<void>>();

/**
 * Make sure `name` exists on the remote, forking from `fromRef` (default:
 * defaultBranch()) if missing. Cheap after the first success per branch.
 * Concurrent callers share one in-flight promise per branch so we don't race
 * on branchExists/createBranch (parallel getFile/putFile in a single request);
 * a 422 "already exists" from a lost race is treated as success.
 */
export function ensureBranch(name: string, fromRef?: string): Promise<void> {
  if (ensuredBranches.has(name)) return Promise.resolve();
  const inflight = ensureInFlight.get(name);
  if (inflight) return inflight;
  const from = fromRef || defaultBranch();
  const p = (async () => {
    if (name === from) {
      ensuredBranches.add(name);
      return;
    }
    if (!(await branchExists(name))) {
      try {
        await createBranch(name, from);
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status !== 422) throw err;
      }
    }
    ensuredBranches.add(name);
  })().finally(() => {
    ensureInFlight.delete(name);
  });
  ensureInFlight.set(name, p);
  return p;
}

/**
 * Ensure the current project's working branch exists — forking its base branch
 * from the global default first (so a project with a not-yet-created base still
 * works), then the working branch from that base. Called by every ref-less
 * getFile/putFile.
 */
export async function ensureWorkingBranch(): Promise<void> {
  const base = baseBranch();
  await ensureBranch(base, defaultBranch());
  await ensureBranch(workingBranch(), base);
}

// ── Read operations (subpath-addressed core; CMS-content-relative) ──

/** Repo path (CMS-content/…) for a CMS-content-relative subpath. */
function repoPathForSub(sub: string): string {
  return REPO_CONTENT_PREFIX + sub;
}

export async function getFileAt(sub: string, ref?: string): Promise<GitHubFile> {
  if (!ref) await ensureWorkingBranch();
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: repoPathForSub(sub),
    ref: ref || workingBranch(),
  });
  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`Path ${sub} is not a file`);
  }
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { path: subpathToContent(sub), content, sha: data.sha, encoding: "utf-8" };
}

export async function listFilesAt(sub: string, ref?: string): Promise<string[]> {
  if (!ref) await ensureWorkingBranch();
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: repoPathForSub(sub),
    ref: ref || workingBranch(),
  });
  if (!Array.isArray(data)) {
    throw new Error(`Path ${sub} is not a directory`);
  }
  return data.map((item: { path: string }) => fromRepoPath(item.path));
}

/** Whether a blob exists at `sub` (uses the memoized tree). */
export async function existsAt(sub: string, ref?: string): Promise<boolean> {
  const target = repoPathForSub(sub);
  const tree = await getTree(ref);
  return tree.some((item) => item.type === "blob" && item.path === target);
}

/** App `content/<rel>` paths of every blob under `sub` (uses the memoized tree). */
export async function listFilesRecursiveAt(sub: string, ref?: string): Promise<string[]> {
  const prefix = repoPathForSub(sub);
  const tree = await getTree(ref);
  return tree
    .filter((item) => item.type === "blob" && item.path.startsWith(prefix))
    .map((item) => fromRepoPath(item.path));
}

// getTree is recursive and whole-repo; memoize it so override existence probes
// (one per uncached read) don't each cost a tree fetch. Writes invalidate the
// `tree:` prefix so a freshly forked/removed override is seen immediately.
const TREE_TTL_MS = 60_000;

export async function getTree(ref?: string): Promise<GitHubTreeItem[]> {
  const treeSha = ref || workingBranch();
  return memoize(
    `tree:${treeSha}`,
    async () => {
      if (!ref) await ensureWorkingBranch();
      const octokit = getOctokit();
      const { owner, repo } = getRepo();
      const { data } = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: treeSha,
        recursive: "true",
      });
      return data.tree as GitHubTreeItem[];
    },
    TREE_TTL_MS
  );
}

function invalidateTreeCache(): void {
  invalidatePrefix("tree:");
}

// ── Write operations (subpath-addressed core) ──

export async function putFileAt(
  sub: string,
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
      const existing = await getFileAt(sub, branch || workingBranch());
      fileSha = existing.sha;
    } catch {
      // File doesn't exist yet, that's fine
    }
  }

  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: repoPathForSub(sub),
    message,
    content: Buffer.from(content).toString("base64"),
    branch: branch || workingBranch(),
    ...(fileSha ? { sha: fileSha } : {}),
  });

  invalidateTreeCache();
  return {
    sha: data.content?.sha || "",
    commitSha: data.commit.sha || "",
  };
}

/**
 * Byte-exact copy of one blob to another path. Passes the source's base64
 * through verbatim, so it's binary-safe (unlike get(utf-8)+put, which mangles
 * images). Used to fork a shared asset into a project override.
 */
export async function copyFileAt(
  fromSub: string,
  toSub: string,
  message: string,
  branch?: string
): Promise<void> {
  if (!branch) await ensureWorkingBranch();
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: repoPathForSub(fromSub),
    ref: branch || workingBranch(),
  });
  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`Path ${fromSub} is not a file`);
  }
  const base64 = data.content.replace(/\n/g, ""); // already base64; write verbatim
  let sha: string | undefined;
  try {
    sha = (await getFileAt(toSub, branch || workingBranch())).sha;
  } catch {
    // target doesn't exist yet
  }
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: repoPathForSub(toSub),
    message,
    content: base64,
    branch: branch || workingBranch(),
    ...(sha ? { sha } : {}),
  });
  invalidateTreeCache();
}

export async function deleteFileAt(
  sub: string,
  message: string,
  branch?: string
): Promise<void> {
  if (!branch) await ensureWorkingBranch();
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const file = await getFileAt(sub, branch || workingBranch());
  await octokit.rest.repos.deleteFile({
    owner,
    repo,
    path: repoPathForSub(sub),
    message,
    sha: file.sha,
    branch: branch || workingBranch(),
  });
  invalidateTreeCache();
}

// ── App-path wrappers (content/<rel>) — delegate through the path mapper ──

export async function getFile(path: string, ref?: string): Promise<GitHubFile> {
  return getFileAt(contentSubpathFromApp(path), ref);
}

export async function listFiles(path: string, ref?: string): Promise<string[]> {
  return listFilesAt(contentSubpathFromApp(path), ref);
}

export async function putFile(
  path: string,
  content: string,
  message: string,
  branch?: string,
  sha?: string
): Promise<{ sha: string; commitSha: string }> {
  return putFileAt(contentSubpathFromApp(path), content, message, branch, sha);
}

export async function deleteFile(
  path: string,
  message: string,
  branch?: string
): Promise<void> {
  return deleteFileAt(contentSubpathFromApp(path), message, branch);
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
