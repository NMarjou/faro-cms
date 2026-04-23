import { Octokit } from "octokit";
import type { GitHubFile, GitHubTreeItem } from "./types";

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

function defaultBranch() {
  return process.env.GITHUB_DEFAULT_BRANCH || "main";
}

// ── Read operations ──

export async function getFile(
  path: string,
  ref?: string
): Promise<GitHubFile> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
    ref: ref || defaultBranch(),
  });
  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`Path ${path} is not a file`);
  }
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { path: data.path, content, sha: data.sha, encoding: "utf-8" };
}

export async function listFiles(path: string, ref?: string): Promise<string[]> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
    ref: ref || defaultBranch(),
  });
  if (!Array.isArray(data)) {
    throw new Error(`Path ${path} is not a directory`);
  }
  return data.map((item: { path: string }) => item.path);
}

export async function getTree(ref?: string): Promise<GitHubTreeItem[]> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: ref || defaultBranch(),
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
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  // If no SHA provided, try to get existing file's SHA
  let fileSha = sha;
  if (!fileSha) {
    try {
      const existing = await getFile(path, branch);
      fileSha = existing.sha;
    } catch {
      // File doesn't exist yet, that's fine
    }
  }

  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content).toString("base64"),
    branch: branch || defaultBranch(),
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
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const file = await getFile(path, branch);
  await octokit.rest.repos.deleteFile({
    owner,
    repo,
    path,
    message,
    sha: file.sha,
    branch: branch || defaultBranch(),
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
