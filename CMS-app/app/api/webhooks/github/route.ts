import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getFile, putFile } from "@/lib/storage";
import { getPullFiles, defaultBranch } from "@/lib/github";
import { articleFilesFromRepoPaths, markPublishedInToc } from "@/lib/article-workflow";
import type { Toc } from "@/lib/types";

/**
 * GitHub webhook — the post-merge hook that makes "Published" reachable.
 *
 * When a publish PR merges into the default branch, flip `published: true` on
 * the working-branch TOC for the article(s) it shipped, so the editor/list/
 * dashboard/search (which read the working branch) surface "Published".
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
  const merged =
    payload.action === "closed" &&
    pr?.merged === true &&
    pr?.base?.ref === defaultBranch();
  if (!merged) {
    return NextResponse.json({ ok: true, ignored: "not a merge to default branch" });
  }

  try {
    const prNumber = pr?.number ?? payload.number;
    if (!prNumber) {
      return NextResponse.json({ ok: true, marked: [] });
    }

    const articleFiles = articleFilesFromRepoPaths(await getPullFiles(prNumber));
    if (articleFiles.length === 0) {
      return NextResponse.json({ ok: true, marked: [] });
    }

    // Status reads the working branch, so the flag lands there.
    const tocFile = await getFile("content/toc.json");
    const toc = JSON.parse(tocFile.content) as Toc;
    const publishedAt = new Date().toISOString();
    const { marked } = markPublishedInToc(toc, new Set(articleFiles), publishedAt);

    if (marked.length > 0) {
      await putFile(
        "content/toc.json",
        JSON.stringify(toc, null, 2),
        `Mark published: ${marked.join(", ")} (PR #${prNumber})`
      );
    }
    return NextResponse.json({ ok: true, marked });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handling failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
