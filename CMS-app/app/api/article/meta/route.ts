import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile } from "@/lib/storage";
import { mutateJsonFile } from "@/lib/sidecar";
import { findTocArticle, getRequestUser, unauthorized, forbidden } from "@/lib/server-auth";
import { canEditArticle } from "@/lib/permissions";
import type { Toc } from "@/lib/types";

/**
 * POST /api/article/meta
 * Body: { path, tags?, summary?, keywords? } — only the fields present are set.
 *
 * Descriptive article metadata (labels, summary, search keywords) in toc.json.
 * Authorized for tech writers (any article) or the article's owner, so an author
 * can describe their own drafts without the tech-writer-only `/api/toc` gate.
 * Mirrors the ownership pattern of `/api/article/{create,adopt}`.
 *
 * Title/slug are NOT handled here — renaming moves the file and rewrites inbound
 * links, which is `/api/article-move` (tech-writer only).
 */
const TOC_PATH = "content/toc.json";
const ARTICLE_EXT = /\.(mdx|html?)$/i;

/** Trimmed, de-duped, non-empty strings. */
function cleanList(v: unknown): string[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean))]
    : [];
}

export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!user) return unauthorized();

  try {
    const body = (await request.json()) as {
      path?: string;
      tags?: unknown;
      summary?: unknown;
      keywords?: unknown;
    };
    const rel = (body.path || "").replace(/^content\//, "");
    if (!rel || rel.includes("..") || !ARTICLE_EXT.test(rel) || rel.startsWith("snippets/") || rel.startsWith("images/")) {
      return NextResponse.json({ error: "Not an article path" }, { status: 400 });
    }

    // Authorize against the current TOC entry (needs the article's owner).
    let article;
    try {
      article = findTocArticle(JSON.parse((await getFile(TOC_PATH)).content) as Toc, rel);
    } catch {
      article = null;
    }
    if (!article) return NextResponse.json({ error: "Article not in TOC" }, { status: 404 });
    if (!canEditArticle(user.role ?? null, article, user.email)) {
      return forbidden("You can only edit metadata for articles you own");
    }

    const hasTags = "tags" in body;
    const hasSummary = "summary" in body;
    const hasKeywords = "keywords" in body;
    const tags = cleanList(body.tags);
    const keywords = cleanList(body.keywords);
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";

    await mutateJsonFile<Toc>(
      TOC_PATH,
      (cur) => {
        const toc: Toc = cur ?? { categories: [] };
        const art = findTocArticle(toc, rel);
        if (!art) return toc;
        // Empty value → drop the field rather than persisting an empty husk.
        if (hasTags) { if (tags.length) art.tags = tags; else delete art.tags; }
        if (hasKeywords) { if (keywords.length) art.keywords = keywords; else delete art.keywords; }
        if (hasSummary) { if (summary) art.summary = summary; else delete art.summary; }
        return toc;
      },
      `Update metadata for ${article.title}`
    );

    return NextResponse.json({
      ok: true,
      ...(hasTags ? { tags } : {}),
      ...(hasKeywords ? { keywords } : {}),
      ...(hasSummary ? { summary } : {}),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to update metadata";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
