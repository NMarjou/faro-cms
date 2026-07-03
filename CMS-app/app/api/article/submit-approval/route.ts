import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile, putFile } from "@/lib/storage";
import { type Toc } from "@/lib/types";
import { notifyArticleSubmittedForApproval } from "@/lib/notifications";
import {
  getRequestUser,
  loadUsers,
  findTocArticle,
  forbidden,
} from "@/lib/server-auth";
import { canSubmitForApproval } from "@/lib/permissions";

/**
 * POST /api/article/submit-approval
 * Body: { path: string }
 *
 * Marks an author's article as awaiting tech-writer sign-off (sets
 * `approvalStatus: "submitted"` in the TOC) and notifies all tech writers.
 * Publishing the article is the sign-off; editing it clears the status.
 * Only the article's owning author may submit it — the submitter is taken
 * from the authenticated identity, not the request body.
 */
export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const caller = await getRequestUser(request);
  try {
    const body = await request.json();
    const { path } = body as { path?: string };

    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    const tocFile = await getFile("content/toc.json");
    const toc = JSON.parse(tocFile.content) as Toc;
    const article = findTocArticle(toc, path);
    if (!article) {
      return NextResponse.json(
        { error: "Article not found in TOC" },
        { status: 404 }
      );
    }

    // Only the owning author may submit their own article for sign-off.
    if (!canSubmitForApproval(caller?.role ?? null, article, caller?.email)) {
      return forbidden();
    }
    const submittedBy = caller!.email;

    article.approvalStatus = "submitted";
    article.submittedBy = submittedBy;
    article.submittedAt = new Date().toISOString().split("T")[0];

    await putFile(
      "content/toc.json",
      JSON.stringify(toc, null, 2),
      `Submit ${article.title} for approval`
    );

    // Notify tech writers. Fire-and-forget — never gate the response on
    // email/Slack latency (same pattern as share / review-done).
    void (async () => {
      try {
        const users = await loadUsers();
        const submitter = users.find(
          (u) => u.email.toLowerCase() === submittedBy.toLowerCase()
        );
        const recipientEmails = users
          .filter((u) => u.role === "tech-writer")
          .map((u) => u.email);
        const baseUrl = process.env.CMS_PUBLIC_URL || request.nextUrl.origin;
        await notifyArticleSubmittedForApproval({
          recipientEmails,
          submitterEmail: submittedBy,
          submitterName: submitter?.name,
          articleTitle: article.title,
          articleFile: article.file,
          baseUrl,
        });
      } catch {
        /* notifications never gate the response */
      }
    })();

    return NextResponse.json({ ok: true, approvalStatus: "submitted" });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Failed to submit for approval";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
