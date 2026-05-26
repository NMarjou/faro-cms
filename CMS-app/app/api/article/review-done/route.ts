import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile } from "@/lib/storage";
import {
  DEFAULT_USERS,
  type Toc,
  type TocArticle,
  type User,
  type UsersData,
} from "@/lib/types";
import { notifyReviewMarkedDone } from "@/lib/notifications";

async function loadUsers(): Promise<User[]> {
  try {
    const file = await getFile("content/users.json");
    const data = JSON.parse(file.content) as UsersData;
    return data.users || DEFAULT_USERS;
  } catch {
    return DEFAULT_USERS;
  }
}

/**
 * POST /api/article/review-done
 * Body: { path, reviewerEmail, done? = true }
 *
 * Adds (or removes when done=false) the reviewer's email in the article's
 * `reviewsDone` array in the TOC. Idempotent — re-posting "done" on an
 * already-done review is a no-op. The contributor is allowed to retract
 * (done=false) in case they marked it prematurely.
 *
 * Validates that `reviewerEmail` is actually in the article's `assignedTo`
 * list — a contributor can only complete a review for an article they were
 * assigned to.
 */

function findArticle(toc: Toc, file: string): TocArticle | null {
  for (const cat of toc.categories) {
    for (const sec of cat.sections) {
      const direct = sec.articles.find((a) => a.file === file);
      if (direct) return direct;
      if (sec.subsections) {
        for (const sub of sec.subsections) {
          const nested = sub.articles.find((a) => a.file === file);
          if (nested) return nested;
        }
      }
    }
  }
  return toc.articles?.find((a) => a.file === file) || null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, reviewerEmail, done } = body as {
      path?: string;
      reviewerEmail?: string;
      done?: boolean;
    };
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (!reviewerEmail || typeof reviewerEmail !== "string") {
      return NextResponse.json({ error: "reviewerEmail is required" }, { status: 400 });
    }
    const markDone = done !== false; // default true

    const tocFile = await getFile("content/toc.json");
    const toc = JSON.parse(tocFile.content) as Toc;
    const article = findArticle(toc, path);
    if (!article) {
      return NextResponse.json({ error: "Article not found in TOC" }, { status: 404 });
    }

    const assigned = (article.assignedTo || []).map((e) => e.toLowerCase());
    const lowerEmail = reviewerEmail.toLowerCase();
    if (!assigned.includes(lowerEmail)) {
      return NextResponse.json(
        { error: "Reviewer is not assigned to this article" },
        { status: 403 }
      );
    }

    const currentDone = new Set((article.reviewsDone || []).map((e) => e.toLowerCase()));
    const wasDone = currentDone.has(lowerEmail);

    // Build the new list, preserving the original casings of emails that
    // were already in the array — we only ever toggle the current reviewer.
    if (markDone && !wasDone) {
      article.reviewsDone = [...(article.reviewsDone || []), reviewerEmail];
    } else if (!markDone && wasDone) {
      article.reviewsDone = (article.reviewsDone || []).filter(
        (e) => e.toLowerCase() !== lowerEmail
      );
      if (article.reviewsDone.length === 0) delete article.reviewsDone;
    }

    await putFile(
      "content/toc.json",
      JSON.stringify(toc, null, 2),
      markDone
        ? `Mark review done: ${reviewerEmail} on ${article.title}`
        : `Reopen review: ${reviewerEmail} on ${article.title}`
    );

    // Fire the tech-writer notification only on the done flip (not on reopen).
    // Recipients: the assignedBy if set, else all tech writers as a fallback.
    if (markDone && !wasDone) {
      void (async () => {
        try {
          const users = await loadUsers();
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
            // Fallback for legacy articles shared before we tracked the
            // assigner: ping all tech writers.
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
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to update review status";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
