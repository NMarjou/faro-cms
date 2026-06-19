import { NextRequest, NextResponse } from "next/server";
import { getFile } from "@/lib/storage";
import { mutateJsonFile } from "@/lib/sidecar";
import type { Suggestion, SuggestionsData } from "@/lib/types";
import { getRequestUser, forbidden } from "@/lib/server-auth";

/**
 * Suggested edits API — sidecar JSON per article on the working branch.
 *
 *   GET  /api/article/suggestions?path=<articleFile>
 *   POST /api/article/suggestions  body: { path, suggestion }
 *
 * For an article at `help/passport/getting-started.mdx`, suggestions live at
 * `CMS-content/help/passport/getting-started.suggestions.json`. Suggestions
 * are append-only at this stage; accept/reject endpoints will land in Phase
 * 3b and rewrite the article HTML when accepted.
 */

function sidecarPath(articleFile: string): string {
  const trimmed = articleFile.replace(/\.[a-zA-Z0-9]+$/, "");
  return `content/${trimmed}.suggestions.json`;
}

async function readSidecar(articleFile: string): Promise<Suggestion[]> {
  try {
    const file = await getFile(sidecarPath(articleFile));
    const data = JSON.parse(file.content) as SuggestionsData;
    return Array.isArray(data.suggestions) ? data.suggestions : [];
  } catch {
    return [];
  }
}

function newId(): string {
  return `sug_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  const suggestions = await readSidecar(path);
  return NextResponse.json({ suggestions });
}

export async function POST(request: NextRequest) {
  // Any signed-in user (tech-writer, author, or contributor) may suggest.
  // The suggestion's author is taken from the authenticated identity, not
  // the request body, so a caller can't post under someone else's name.
  const caller = await getRequestUser(request);
  if (!caller) return forbidden();
  try {
    const body = await request.json();
    const { path, suggestion } = body as {
      path?: string;
      suggestion?: Partial<Suggestion>;
    };

    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (!suggestion || typeof suggestion !== "object") {
      return NextResponse.json({ error: "suggestion is required" }, { status: 400 });
    }
    const { originalText, suggestedText, occurrenceIndex, note } = suggestion;
    const author = caller.email;
    const authorName = caller.name;

    if (!originalText || typeof originalText !== "string") {
      return NextResponse.json({ error: "suggestion.originalText is required" }, { status: 400 });
    }
    if (typeof suggestedText !== "string") {
      return NextResponse.json({ error: "suggestion.suggestedText is required" }, { status: 400 });
    }
    if (originalText === suggestedText) {
      return NextResponse.json(
        { error: "Suggested text is identical to the original" },
        { status: 400 }
      );
    }

    const entry: Suggestion = {
      id: newId(),
      author,
      authorName,
      createdAt: new Date().toISOString(),
      originalText,
      suggestedText,
      status: "pending",
      occurrenceIndex: typeof occurrenceIndex === "number" ? occurrenceIndex : undefined,
      note: note?.trim() || undefined,
    };

    // Append through the concurrency-safe writer so a simultaneous suggestion
    // from another reviewer isn't dropped.
    const data = await mutateJsonFile<SuggestionsData>(
      sidecarPath(path),
      (cur) => ({ suggestions: [...(cur?.suggestions ?? []), entry] }),
      `Suggestion: ${(authorName || author)} on ${path.split("/").pop()}`
    );

    return NextResponse.json({ suggestion: entry, suggestions: data.suggestions });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save suggestion";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
