import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile, putFile } from "@/lib/storage";
import { type Toc } from "@/lib/types";
import { notifyArticleSharedForReview } from "@/lib/notifications";
import {
  getRequestUser,
  loadUsers,
  findTocArticle,
  forbidden,
} from "@/lib/server-auth";
import { isTechWriter } from "@/lib/permissions";

/**
 * POST /api/article/share
 * Body: {
 *   path: string,                      // article file path (e.g. "help/foo.mdx")
 *   emails: string[],                  // full new reviewer set
 *   senderEmail?: string,              // identity of the tech writer (from User Settings)
 * }
 *
 * Replaces the article's `assignedTo` array in the TOC, then fans out review
 * notifications for any reviewers who weren't already on the list. Reviewers
 * removed from the list don't get a "you've been unassigned" notification —
 * we treat removals as quiet to avoid mailbox noise during iteration.
 */
export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const caller = await getRequestUser(request);
  if (!isTechWriter(caller?.role ?? null)) return forbidden();
  try {
    const body = await request.json();
    const { path, emails, senderEmail } = body as {
      path?: string;
      emails?: string[];
      senderEmail?: string;
    };

    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (!Array.isArray(emails)) {
      return NextResponse.json({ error: "emails array is required" }, { status: 400 });
    }

    // Load TOC + locate the article entry.
    const tocFile = await getFile("content/toc.json");
    const toc = JSON.parse(tocFile.content) as Toc;
    const article = findTocArticle(toc, path);
    if (!article) {
      return NextResponse.json({ error: "Article not found in TOC" }, { status: 404 });
    }

    // Detect newly-added reviewers — only these get pinged.
    const previous = new Set((article.assignedTo || []).map((e) => e.toLowerCase()));
    const newlyAdded = emails.filter((e) => !previous.has(e.toLowerCase()));

    // Update the TOC entry.
    if (emails.length > 0) {
      article.assignedTo = emails;
      // Record who initiated this share so the review-done flow can ping
      // them later. Falls through to the all-tech-writers broadcast in
      // /api/article/review-done if senderEmail isn't provided.
      if (senderEmail) article.assignedBy = senderEmail;
    } else {
      delete article.assignedTo;
      delete article.assignedBy;
    }
    // A fresh share starts a new review round. Any previous tech-writer
    // sign-off is no longer authoritative — clear it so the article is
    // back to "in review" and publish is gated again until a new sign-off.
    delete article.reviewComplete;
    delete article.reviewCompletedBy;
    delete article.reviewCompletedAt;
    // Per-contributor "review done" rows from the previous round are
    // also stale; clear so the new reviewers start from a clean slate.
    delete article.reviewsDone;

    const writeMessage =
      emails.length > 0
        ? `Send ${article.title} for review (${emails.length} contributor${emails.length === 1 ? "" : "s"})`
        : `Clear review assignment for ${article.title}`;

    await putFile("content/toc.json", JSON.stringify(toc, null, 2), writeMessage);

    // Fan out notifications for newly-added reviewers. Resolve names/emails
    // against the user list so the messages address people, not addresses.
    if (newlyAdded.length > 0) {
      const users = await loadUsers();
      const usersByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

      const sender = senderEmail
        ? usersByEmail.get(senderEmail.toLowerCase())
        : undefined;
      const techWriterName = sender?.name || sender?.email || "A Faro CMS tech writer";

      // The base URL for the deep-link in the Slack message. Honour an explicit
      // env var, else use the request's own origin.
      const baseUrl =
        process.env.CMS_PUBLIC_URL ||
        request.nextUrl.origin;

      void Promise.all(
        newlyAdded.map((email) => {
          const reviewer = usersByEmail.get(email.toLowerCase());
          return notifyArticleSharedForReview({
            reviewerEmail: email,
            reviewerName: reviewer?.name,
            techWriterName,
            techWriterEmail: sender?.email,
            articleTitle: article.title,
            articleFile: article.file,
            baseUrl,
          });
        })
      );
    }

    return NextResponse.json({
      ok: true,
      assigned: emails,
      notified: newlyAdded,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to share";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
