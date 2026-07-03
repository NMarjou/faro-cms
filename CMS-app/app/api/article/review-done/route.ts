import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile, putFile } from "@/lib/storage";
import {
  type Suggestion,
  type SuggestionsData,
  type Toc,
} from "@/lib/types";
import { notifyReviewMarkedDone, notifyReviewSignedOff } from "@/lib/notifications";
import { getRequestUser, loadUsers, findTocArticle, forbidden } from "@/lib/server-auth";

/**
 * POST /api/article/review-done
 * Body: { path, reviewerEmail, done? = true }
 *
 * Branches by caller's role:
 *
 * - **Contributor** assigned to the article: toggles their email in the
 *   article's `reviewsDone[]`. Gated on "no unresolved comments / no
 *   pending suggestions" — flipping done while items are outstanding is
 *   meaningless. Notifies the assigning tech writer on the done flip.
 *
 * - **Tech writer**: flips the article-level `reviewComplete` flag. Same
 *   gate as the contributor's (publish would be blocked anyway), but
 *   tech-writer can act regardless of `assignedTo`. Notifies every
 *   assigned contributor on the sign-off flip.
 *
 * Idempotent — re-posting "done" on an already-done flip is a no-op.
 * Returns 409 when the gate refuses, with `unresolvedComments` and
 * `pendingSuggestions` counts so the UI can render a precise warning.
 */

function sidecarSuggestionsPath(articleFile: string): string {
  const trimmed = articleFile.replace(/\.[a-zA-Z0-9]+$/, "");
  return `content/${trimmed}.suggestions.json`;
}

function sidecarCommentsPath(articleFile: string): string {
  const trimmed = articleFile.replace(/\.[a-zA-Z0-9]+$/, "");
  return `content/${trimmed}.comments.json`;
}

async function countPendingSuggestions(articleFile: string): Promise<number> {
  try {
    const file = await getFile(sidecarSuggestionsPath(articleFile));
    const data = JSON.parse(file.content) as SuggestionsData;
    return (data.suggestions || []).filter(
      (s: Suggestion) => s.status === "pending"
    ).length;
  } catch {
    return 0;
  }
}

async function countUnresolvedComments(articleFile: string): Promise<number> {
  try {
    const file = await getFile(sidecarCommentsPath(articleFile));
    const data = JSON.parse(file.content) as { comments?: { resolved?: boolean }[] };
    return (data.comments || []).filter((c) => !c.resolved).length;
  } catch {
    return 0;
  }
}

export async function POST(request: NextRequest) {
  await setRequestProject(request);
  // The reviewer is the authenticated caller — never trust a body-supplied
  // email. Tech writers can sign off any article; contributors only ones
  // they're assigned to (checked below).
  const caller = await getRequestUser(request);
  if (!caller) return forbidden();
  try {
    const body = await request.json();
    const { path, done, force } = body as {
      path?: string;
      done?: boolean;
      /** Tech-writer override to sign off despite outstanding contributor reviews. */
      force?: boolean;
    };
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    const reviewerEmail = caller.email;
    const markDone = done !== false; // default true

    const tocFile = await getFile("content/toc.json");
    const toc = JSON.parse(tocFile.content) as Toc;
    const article = findTocArticle(toc, path);
    if (!article) {
      return NextResponse.json({ error: "Article not found in TOC" }, { status: 404 });
    }

    const users = await loadUsers();
    const lowerEmail = reviewerEmail.toLowerCase();
    const isTechWriter = caller.role === "tech-writer";

    if (!isTechWriter) {
      const assigned = (article.assignedTo || []).map((e) => e.toLowerCase());
      if (!assigned.includes(lowerEmail)) {
        return NextResponse.json(
          { error: "Reviewer is not assigned to this article" },
          { status: 403 }
        );
      }
    }

    // Gate the done flip on outstanding items. Reopen (done=false) skips
    // the gate — you can always retract.
    if (markDone) {
      const [pendingSuggestions, unresolvedComments] = await Promise.all([
        countPendingSuggestions(path),
        countUnresolvedComments(path),
      ]);
      if (pendingSuggestions > 0 || unresolvedComments > 0) {
        return NextResponse.json(
          {
            error:
              "Cannot mark review done while items are outstanding.",
            pendingSuggestions,
            unresolvedComments,
          },
          { status: 409 }
        );
      }

      // Soft gate: a tech writer signing off while assigned contributors
      // haven't all marked their review done. The tech writer keeps ultimate
      // authority — `force` overrides — but the choice is now surfaced instead
      // of silently ignoring `reviewsDone`.
      if (isTechWriter && !force) {
        const assigned = (article.assignedTo || []).map((e) => e.toLowerCase());
        const doneSet = new Set((article.reviewsDone || []).map((e) => e.toLowerCase()));
        const outstanding = assigned.filter((e) => !doneSet.has(e));
        if (outstanding.length > 0) {
          return NextResponse.json(
            {
              error: "Some assigned reviewers haven't marked their review done.",
              needsConfirm: true,
              reviewsDoneCount: assigned.length - outstanding.length,
              totalReviewers: assigned.length,
            },
            { status: 409 }
          );
        }
      }
    }

    let wasNewlyDone = false;

    if (isTechWriter) {
      // Article-level sign-off.
      if (markDone) {
        wasNewlyDone = !article.reviewComplete;
        article.reviewComplete = true;
        article.reviewCompletedBy = reviewerEmail;
        article.reviewCompletedAt = new Date().toISOString();
        // Signing off fulfills an author's pending submit-for-approval —
        // the request has been answered, so clear the waiting flag.
        if (article.approvalStatus === "submitted") {
          delete article.approvalStatus;
          delete article.submittedBy;
          delete article.submittedAt;
        }
      } else {
        delete article.reviewComplete;
        delete article.reviewCompletedBy;
        delete article.reviewCompletedAt;
      }
    } else {
      // Per-contributor row in reviewsDone[].
      const currentDone = new Set(
        (article.reviewsDone || []).map((e) => e.toLowerCase())
      );
      const wasDone = currentDone.has(lowerEmail);
      if (markDone && !wasDone) {
        article.reviewsDone = [...(article.reviewsDone || []), reviewerEmail];
        wasNewlyDone = true;
      } else if (!markDone && wasDone) {
        article.reviewsDone = (article.reviewsDone || []).filter(
          (e) => e.toLowerCase() !== lowerEmail
        );
        if (article.reviewsDone.length === 0) delete article.reviewsDone;
      }
    }

    await putFile(
      "content/toc.json",
      JSON.stringify(toc, null, 2),
      markDone
        ? `Mark review done: ${reviewerEmail} on ${article.title}`
        : `Reopen review: ${reviewerEmail} on ${article.title}`
    );

    // Tech-writer signs off → ping every assigned contributor so they
    // know the round is closed and any pending suggestions won't be
    // actioned further. Only fires on the done flip (not on reopen).
    if (markDone && wasNewlyDone && isTechWriter) {
      const recipients = article.assignedTo || [];
      if (recipients.length > 0) {
        void (async () => {
          try {
            const recipientNames: Record<string, string | undefined> = {};
            for (const email of recipients) {
              const u = users.find(
                (x) => x.email.toLowerCase() === email.toLowerCase()
              );
              recipientNames[email.toLowerCase()] = u?.name;
            }
            const baseUrl =
              process.env.CMS_PUBLIC_URL || request.nextUrl.origin;
            await notifyReviewSignedOff({
              recipientEmails: recipients,
              recipientNames,
              techWriterName: caller.name || caller.email,
              techWriterEmail: caller.email,
              articleTitle: article.title,
              articleFile: path,
              baseUrl,
            });
          } catch {
            /* never gate the response on notification failures */
          }
        })();
      }
    }

    // Contributor sign-off → ping the tech writer who initiated the share
    // (or all tech writers as a fallback). Only on the done flip.
    if (markDone && wasNewlyDone && !isTechWriter) {
      void (async () => {
        try {
          const reviewer = users.find(
            (u) => u.email.toLowerCase() === lowerEmail
          );
          let recipientEmails: string[] = [];
          if (article.assignedBy) {
            const assigner = users.find(
              (u) => u.email.toLowerCase() === article.assignedBy!.toLowerCase()
            );
            if (assigner) recipientEmails = [assigner.email];
          }
          if (recipientEmails.length === 0) {
            recipientEmails = users
              .filter((u) => u.role === "tech-writer")
              .map((u) => u.email);
          }
          const baseUrl =
            process.env.CMS_PUBLIC_URL || request.nextUrl.origin;
          await notifyReviewMarkedDone({
            recipientEmails,
            reviewerEmail,
            reviewerName: reviewer?.name,
            articleTitle: article.title,
            articleFile: path,
            baseUrl,
            reviewsDoneCount: article.reviewsDone?.length || 0,
            totalReviewers: article.assignedTo?.length || 0,
          });
        } catch {
          /* notifications never gate the response */
        }
      })();
    }

    return NextResponse.json({
      ok: true,
      reviewsDone: article.reviewsDone || [],
      reviewComplete: article.reviewComplete || false,
      reviewCompletedBy: article.reviewCompletedBy,
      reviewCompletedAt: article.reviewCompletedAt,
      // Reflect the (possibly cleared) approval flag so the editor can mirror it.
      approvalStatus: article.approvalStatus ?? null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to update review status";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
