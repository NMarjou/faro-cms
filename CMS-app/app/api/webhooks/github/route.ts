import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getFile, putFile } from "@/lib/storage";
import { getPullFiles, defaultBranch } from "@/lib/github";
import { runWithProject } from "@/lib/request-context";
import { loadProjects } from "@/lib/projects";
import { articleFilesByProject, markPublishedInToc } from "@/lib/article-workflow";
import type { Toc } from "@/lib/types";

/**
 * GitHub webhook — the post-merge hook that makes "Published" reachable.
 *
 * When a publish PR merges into a project's base (publish) branch, flip
 * `published: true` on that PROJECT's working-branch TOC for the article(s) it
 * shipped, so the editor/list/dashboard/search (which read the working branch)
 * surface "Published". The PR is attributed to a project by the `projects/<slug>/`
 * folder of its changed files, so a single merge can update several projects,
 * and any configured per-project base branch is honored.
 *
 * Configure in the repo: Settings → Webhooks → payload URL
 * `<origin>/api/webhooks/github`, content type application/json, a secret
 * matching GITHUB_WEBHOOK_SECRET, and the "Pull requests" event.
 */

/** Constant-time compare of the GitHub HMAC signature against the raw body. */
function verifySignature(raw: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook not configured (GITHUB_WEBHOOK_SECRET unset)" },
      { status: 503 }
    );
  }

  // Raw body is required for signature verification — read it before parsing.
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // We only act on a pull request that just merged into the default branch.
  if (request.headers.get("x-github-event") !== "pull_request") {
    return NextResponse.json({ ok: true, ignored: "event" });
  }

  let payload: {
    action?: string;
    number?: number;
    pull_request?: { number?: number; merged?: boolean; base?: { ref?: string } };
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pr = payload.pull_request;
  const baseRef = pr?.base?.ref;
  if (payload.action !== "closed" || pr?.merged !== true || !baseRef) {
    return NextResponse.json({ ok: true, ignored: "not a merged PR" });
  }

  // Act on merges into any publish target — the global default branch, or any
  // project's configured base branch.
  const projects = await loadProjects();
  const validBases = new Set<string>([
    defaultBranch(),
    ...projects.map((p) => p.publishTarget?.baseBranch).filter((b): b is string => !!b),
  ]);
  if (!validBases.has(baseRef)) {
    return NextResponse.json({ ok: true, ignored: "not a publish-target branch" });
  }

  try {
    const prNumber = pr?.number ?? payload.number;
    if (!prNumber) {
      return NextResponse.json({ ok: true, marked: [] });
    }

    // Attribute changed article bodies to their project, then mark each in that
    // project's own working-branch TOC (status reads the working branch).
    const byProject = articleFilesByProject(await getPullFiles(prNumber));
    if (byProject.size === 0) {
      return NextResponse.json({ ok: true, marked: [] });
    }

    const publishedAt = new Date().toISOString();
    const allMarked: string[] = [];
    for (const [slug, files] of byProject) {
      await runWithProject(slug, async () => {
        const tocFile = await getFile("content/toc.json");
        const toc = JSON.parse(tocFile.content) as Toc;
        const { marked } = markPublishedInToc(toc, new Set(files), publishedAt);
        if (marked.length > 0) {
          await putFile(
            "content/toc.json",
            JSON.stringify(toc, null, 2),
            `Mark published: ${marked.join(", ")} (${slug}, PR #${prNumber})`
          );
          allMarked.push(...marked.map((f) => `${slug}/${f}`));
        }
      });
    }
    return NextResponse.json({ ok: true, marked: allMarked });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handling failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
