import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile } from "@/lib/storage";
import {
  type Suggestion,
  type SuggestionsData,
  type Toc,
} from "@/lib/types";
import { notifySuggestionResolved } from "@/lib/notifications";
import {
  getRequestUser,
  loadUsers,
  findTocArticle,
  forbidden,
} from "@/lib/server-auth";
import { isTechWriter } from "@/lib/permissions";

/**
 * POST /api/article/suggestions/resolve
 * Body: { path, id, action: "accept" | "reject", reviewerEmail? }
 *
 * Accept:
 *   1. Read the article body
 *   2. Find the Nth occurrence of `originalText` (suggestion.occurrenceIndex)
 *   3. Replace with `suggestedText`
 *   4. Save the article and flip the suggestion's status to "accepted"
 *
 * Reject:
 *   Flip status to "rejected" and leave the article untouched.
 *
 * Both responses include the updated suggestions list so the UI can refresh
 * without an extra GET.
 */

function sidecarPath(articleFile: string): string {
  const trimmed = articleFile.replace(/\.[a-zA-Z0-9]+$/, "");
  return `content/${trimmed}.suggestions.json`;
}

/**
 * Find the Nth (zero-based) occurrence of `needle` in `haystack` and replace
 * it with `replacement`. Returns the new string, or null if the occurrence
 * doesn't exist (typically because intervening HTML markup splits the span).
 */
function replaceNthOccurrence(
  haystack: string,
  needle: string,
  replacement: string,
  index: number
): string | null {
  let cursor = 0;
  let count = 0;
  while (true) {
    const found = haystack.indexOf(needle, cursor);
    if (found === -1) return null;
    if (count === index) {
      return haystack.slice(0, found) + replacement + haystack.slice(found + needle.length);
    }
    count += 1;
    cursor = found + needle.length;
  }
}

export async function POST(request: NextRequest) {
  const caller = await getRequestUser(request);
  if (!isTechWriter(caller?.role ?? null)) return forbidden();
  try {
    const body = await request.json();
    const { path, id, action, resolverEmail } = body as {
      path?: string;
      id?: string;
      action?: "accept" | "reject";
      resolverEmail?: string;
    };
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (action !== "accept" && action !== "reject") {
      return NextResponse.json({ error: "action must be 'accept' or 'reject'" }, { status: 400 });
    }

    // Load sidecar + locate the suggestion.
    const sidecarFile = await getFile(sidecarPath(path));
    const data = JSON.parse(sidecarFile.content) as SuggestionsData;
    const list = Array.isArray(data.suggestions) ? data.suggestions : [];
    const suggestion = list.find((s) => s.id === id);
    if (!suggestion) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }
    if (suggestion.status !== "pending") {
      return NextResponse.json(
        { error: `Suggestion is already ${suggestion.status}` },
        { status: 409 }
      );
    }

    if (action === "accept") {
      // Apply the diff to the article body.
      const articleFile = await getFile(`content/${path}`);
      const updated = replaceNthOccurrence(
        articleFile.content,
        suggestion.originalText,
        suggestion.suggestedText,
        suggestion.occurrenceIndex ?? 0
      );
      if (updated === null) {
        return NextResponse.json(
          {
            error:
              "Original text not found at the expected position. The article may have changed since this suggestion was submitted. Reject and ask the contributor to redo it, or apply the change manually.",
          },
          { status: 422 }
        );
      }
      await putFile(
        `content/${path}`,
        updated,
        `Accept suggestion from ${suggestion.authorName || suggestion.author} on ${path
          .split("/")
          .pop()}`
      );
    }

    // Flip the suggestion's status in the sidecar.
    const nextList: Suggestion[] = list.map((s) =>
      s.id === id ? { ...s, status: action === "accept" ? "accepted" : "rejected" } : s
    );
    await putFile(
      sidecarPath(path),
      JSON.stringify({ suggestions: nextList }, null, 2),
      `${action === "accept" ? "Accept" : "Reject"} suggestion ${id}`
    );

    // Fan out a notification to the original contributor. Resolve the
    // tech writer's display name + the article title from the user list
    // and TOC respectively. Failures are logged inside notifications.ts
    // and never gate the response.
    void (async () => {
      try {
        const users = await loadUsers();
        const resolver = resolverEmail
          ? users.find((u) => u.email.toLowerCase() === resolverEmail.toLowerCase())
          : undefined;
        const resolverName =
          resolver?.name || resolver?.email || "A Faro CMS tech writer";

        let articleTitle = path;
        try {
          const tocFile = await getFile("content/toc.json");
          const toc = JSON.parse(tocFile.content) as Toc;
          const art = findTocArticle(toc, path);
          if (art) articleTitle = art.title;
        } catch {
          /* fall through with the path as title */
        }

        const baseUrl = process.env.CMS_PUBLIC_URL || request.nextUrl.origin;

        await notifySuggestionResolved({
          contributorEmail: suggestion.author,
          contributorName: suggestion.authorName,
          resolverName,
          resolverEmail,
          action,
          originalText: suggestion.originalText,
          suggestedText: suggestion.suggestedText,
          articleTitle,
          articleFile: path,
          baseUrl,
        });
      } catch {
        /* notification failure shouldn't impact the resolve action */
      }
    })();

    return NextResponse.json({ ok: true, suggestion: nextList.find((s) => s.id === id), suggestions: nextList });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to resolve suggestion";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
