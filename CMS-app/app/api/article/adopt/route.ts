import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile } from "@/lib/storage";
import { mutateJsonFile } from "@/lib/sidecar";
import { findTocArticle, getRequestUser, forbidden } from "@/lib/server-auth";
import { canCreateArticles } from "@/lib/permissions";
import type { Toc, TocArticle } from "@/lib/types";

/**
 * POST /api/article/adopt   Body: { path }
 *
 * Recover an ORPHANED article — a body file that exists but has no TOC entry
 * (it's invisible in nav and read-only for authors, since ownership can't be
 * resolved). Inserts a standalone TOC entry for it, stamping the caller as
 * owner. Authorized by `canCreateArticles` (tech-writer or author) and writes
 * toc.json server-side, so an author can adopt their own orphan without the
 * tech-writer-only `/api/toc` gate.
 *
 * Orphans should be rare now that creation is atomic (`/api/article/create`);
 * this is the safety net for pre-existing ones and partial-failure cases.
 */
const TOC_PATH = "content/toc.json";
const ARTICLE_EXT = /\.(mdx|html?)$/i;

/** Best-effort human title: the body's first <h1>, else the slug title-cased. */
function deriveTitle(content: string, slug: string): string {
  const h1 = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim();
  if (h1) return h1;
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!canCreateArticles(user?.role ?? null)) {
    return forbidden("You don't have permission to add articles");
  }
  try {
    const { path } = (await request.json()) as { path?: string };
    const rel = (path || "").replace(/^content\//, "");
    if (!rel || rel.includes("..") || !ARTICLE_EXT.test(rel) || rel.startsWith("snippets/") || rel.startsWith("images/")) {
      return NextResponse.json({ error: "Not an article path" }, { status: 400 });
    }

    // The body must already exist — adopt is recovery, not creation.
    let content = "";
    try {
      content = (await getFile(`content/${rel}`)).content;
    } catch {
      return NextResponse.json({ error: "Article body not found" }, { status: 404 });
    }

    const base = rel.split("/").pop() || rel;
    const slug = base.replace(ARTICLE_EXT, "");
    const format: "html" | "mdx" = /\.mdx$/i.test(rel) ? "mdx" : "html";
    const today = new Date().toISOString().split("T")[0];
    const title = deriveTitle(content, slug);

    let alreadyInToc = false;
    let entry: TocArticle = {
      title, file: rel, slug, format,
      createdDate: today, lastModified: today,
      ...(user!.email ? { author: user!.email } : {}),
    };
    await mutateJsonFile<Toc>(
      TOC_PATH,
      (cur) => {
        const toc: Toc = cur ?? { categories: [] };
        const existing = findTocArticle(toc, rel);
        if (existing) { alreadyInToc = true; entry = existing; return toc; }
        return { ...toc, articles: [...(toc.articles ?? []), entry] };
      },
      `Adopt orphaned article: ${title}`
    );

    // Return the entry so the client can update immediately without a
    // (potentially cache-stale) TOC refetch.
    return NextResponse.json({ ok: true, alreadyInToc, entry });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to add article";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
