import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile } from "@/lib/storage";
import {
  DEFAULT_USERS,
  type Toc,
  type TocArticle,
  type User,
  type UsersData,
} from "@/lib/types";
import { notifyArticleSubmittedForApproval } from "@/lib/notifications";

const USERS_PATH = "content/users.json";

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

async function loadUsers(): Promise<User[]> {
  try {
    const file = await getFile(USERS_PATH);
    const data = JSON.parse(file.content) as UsersData;
    return data.users || DEFAULT_USERS;
  } catch {
    return DEFAULT_USERS;
  }
}

/**
 * POST /api/article/submit-approval
 * Body: { path: string, submittedBy: string }
 *
 * Marks an author's article as awaiting tech-writer sign-off (sets
 * `approvalStatus: "submitted"` in the TOC) and notifies all tech writers.
 * Publishing the article is the sign-off; editing it clears the status.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, submittedBy } = body as {
      path?: string;
      submittedBy?: string;
    };

    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (!submittedBy || typeof submittedBy !== "string") {
      return NextResponse.json(
        { error: "submittedBy is required" },
        { status: 400 }
      );
    }

    const tocFile = await getFile("content/toc.json");
    const toc = JSON.parse(tocFile.content) as Toc;
    const article = findArticle(toc, path);
    if (!article) {
      return NextResponse.json(
        { error: "Article not found in TOC" },
        { status: 404 }
      );
    }

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
