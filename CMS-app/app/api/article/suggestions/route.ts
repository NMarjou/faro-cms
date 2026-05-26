import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile } from "@/lib/storage";
import type { Suggestion, SuggestionsData } from "@/lib/types";

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

async function writeSidecar(
  articleFile: string,
  suggestions: Suggestion[],
  message: string
): Promise<void> {
  const body: SuggestionsData = { suggestions };
  await putFile(sidecarPath(articleFile), JSON.stringify(body, null, 2), message);
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
    const { author, originalText, suggestedText, authorName, occurrenceIndex, note } =
      suggestion;

    if (!author || typeof author !== "string") {
      return NextResponse.json({ error: "suggestion.author is required" }, { status: 400 });
    }
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

    const existing = await readSidecar(path);
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
    const next = [...existing, entry];

    await writeSidecar(
      path,
      next,
      `Suggestion: ${(authorName || author)} on ${path.split("/").pop()}`
    );

    return NextResponse.json({ suggestion: entry, suggestions: next });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save suggestion";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
