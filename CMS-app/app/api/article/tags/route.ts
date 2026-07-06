import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile } from "@/lib/storage";
import { mutateJsonFile } from "@/lib/sidecar";
import { findTocArticle, getRequestUser, unauthorized, forbidden } from "@/lib/server-auth";
import { canEditArticle } from "@/lib/permissions";
import type { Toc } from "@/lib/types";

/**
 * POST /api/article/tags   Body: { path, tags: string[] }
 *
 * Set an article's labels (its `tags` in toc.json). Authorized for tech writers
 * (any article) or the article's owner — so an author can label their own
 * drafts without the tech-writer-only `/api/toc` gate. Mirrors the ownership
 * pattern of `/api/article/{create,adopt}`.
 */
const TOC_PATH = "content/toc.json";
const ARTICLE_EXT = /\.(mdx|html?)$/i;

export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!user) return unauthorized();

  try {
    const { path, tags } = (await request.json()) as { path?: string; tags?: unknown };
    const rel = (path || "").replace(/^content\//, "");
    if (!rel || rel.includes("..") || !ARTICLE_EXT.test(rel) || rel.startsWith("snippets/") || rel.startsWith("images/")) {
      return NextResponse.json({ error: "Not an article path" }, { status: 400 });
    }

    // Normalize: trimmed, de-duped, non-empty strings.
    const clean = Array.isArray(tags)
      ? [...new Set(tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean))]
      : [];

    // Authorize against the current TOC entry (needs the article's owner).
    let article;
    try {
      article = findTocArticle(JSON.parse((await getFile(TOC_PATH)).content) as Toc, rel);
    } catch {
      article = null;
    }
    if (!article) return NextResponse.json({ error: "Article not in TOC" }, { status: 404 });
    if (!canEditArticle(user.role ?? null, article, user.email)) {
      return forbidden("You can only label articles you own");
    }

    await mutateJsonFile<Toc>(
      TOC_PATH,
      (cur) => {
        const toc: Toc = cur ?? { categories: [] };
        const art = findTocArticle(toc, rel);
        if (art) {
          if (clean.length) art.tags = clean;
          else delete art.tags;
        }
        return toc;
      },
      `Update labels for ${article.title}`
    );

    return NextResponse.json({ ok: true, tags: clean });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to update labels";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
