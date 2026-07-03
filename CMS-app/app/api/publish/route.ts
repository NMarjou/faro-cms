import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import {
  createBranch,
  createPR,
  branchExists,
  defaultBranch,
  workingBranch,
  ensureWorkingBranch,
} from "@/lib/github";
import { getFile } from "@/lib/storage";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { canPublish } from "@/lib/permissions";
import { articleOwesSignoff } from "@/lib/article-workflow";
import type { Toc, TocArticle } from "@/lib/types";

/**
 * Walk the TOC and return every article that's blocking publish — i.e. it
 * still owes a tech-writer sign-off (`reviewComplete !== true`) for either
 * review track:
 *   - sent for contributor review (`assignedTo` non-empty), or
 *   - submitted for approval by its author (`approvalStatus === "submitted"`).
 * Articles in neither track are unaffected — review is optional, but once an
 * article enters a track it must be signed off before it can publish.
 */
function collectArticles(toc: Toc): TocArticle[] {
  const all: TocArticle[] = [];
  for (const cat of toc.categories || []) {
    for (const sec of cat.sections || []) {
      all.push(...sec.articles);
      if (sec.subsections) {
        for (const sub of sec.subsections) all.push(...sub.articles);
      }
    }
  }
  if (toc.articles) all.push(...toc.articles);
  return all;
}

function findBlockingArticles(toc: Toc): Array<{ file: string; title: string }> {
  return collectArticles(toc)
    .filter(articleOwesSignoff)
    .map((a) => ({ file: a.file, title: a.title }));
}

export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!canPublish(user?.role ?? null)) return forbidden("Only tech writers can publish");
  try {
    const body = await request.json();
    const { title, description, branch: explicitBranch } = body;

    if (!title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    // "Publish all" opens a PR from this project's working branch into the
    // canonical default branch — NOT the per-project base branch. It ships a
    // project's whole working state to the default branch; per-project base
    // targeting applies to the isolated per-article publish. `head` is the
    // current project's working branch (resolved in the request context).
    const base = defaultBranch();
    const head = explicitBranch || workingBranch();

    if (head === base) {
      return NextResponse.json(
        {
          error:
            "Working branch equals the default branch — nothing to publish. Set a separate working branch (env CMS_WORKING_BRANCH or the project's publishTarget) so edits land there first.",
        },
        { status: 400 }
      );
    }

    if (!explicitBranch) await ensureWorkingBranch();
    else if (!(await branchExists(head))) await createBranch(head);

    // Gate: refuse the PR if any article on the working branch is still
    // awaiting sign-off. Source of truth is the TOC on the working branch
    // — that's the version the PR would publish. Articles never sent for
    // review pass through cleanly (review is optional per the workflow
    // spec). Mirrors the client-side check in the editor's Publish button
    // and catches the edge case where a save just cleared `reviewComplete`
    // between gate-check and publish-call.
    try {
      const tocFile = await getFile("content/toc.json", head);
      const toc = JSON.parse(tocFile.content) as Toc;
      const blocking = findBlockingArticles(toc);
      if (blocking.length > 0) {
        const preview = blocking
          .slice(0, 3)
          .map((a) => a.title)
          .join(", ");
        const more = blocking.length > 3 ? ` (+${blocking.length - 3} more)` : "";
        return NextResponse.json(
          {
            error:
              `Cannot publish — ${blocking.length} article${blocking.length === 1 ? "" : "s"} ` +
              `await${blocking.length === 1 ? "s" : ""} tech-writer sign-off: ${preview}${more}.`,
            blocking,
          },
          { status: 409 }
        );
      }
    } catch (err) {
      // A missing or unreadable toc.json shouldn't silently let an
      // unreviewed publish through — surface the underlying error.
      const msg = err instanceof Error ? err.message : "Failed to read TOC";
      return NextResponse.json(
        { error: `Could not verify review state: ${msg}` },
        { status: 500 }
      );
    }

    const pr = await createPR(
      title,
      description || "Content update from CMS editor",
      head,
      base
    );

    return NextResponse.json({
      branch: head,
      prUrl: pr.url,
      prNumber: pr.number,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to publish";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
