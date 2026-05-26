import { NextResponse } from "next/server";
import { getFile } from "@/lib/storage";
import type { Suggestion, SuggestionsData, Toc, TocArticle } from "@/lib/types";

/**
 * GET /api/suggestions
 *
 * Cross-article rollup. Walks the TOC, opens each article's sidecar
 * (`<article>.suggestions.json`) in parallel, and returns one entry per
 * article that has at least one *pending* suggestion. Used by the
 * /review queue page and the sidebar badge.
 *
 * Returns:
 *   {
 *     articles: [{ articleFile, articleTitle, articleSlug, pending, previews }],
 *     totalPending: number
 *   }
 */

interface ArticleEntry {
  articleFile: string;
  articleTitle: string;
  articleSlug: string;
  pending: number;
  /** Up to 3 pending suggestion previews so the queue page doesn't need a
   *  second roundtrip per article. */
  previews: Suggestion[];
}

function collectArticles(toc: Toc): TocArticle[] {
  const all: TocArticle[] = [];
  for (const cat of toc.categories || []) {
    for (const sec of cat.sections || []) {
      all.push(...sec.articles);
      if (sec.subsections) {
        for (const sub of sec.subsections) all.push(...sub.articles);
      }
    }
  }
  if (toc.articles) all.push(...toc.articles);
  return all;
}

function sidecarPath(articleFile: string): string {
  const trimmed = articleFile.replace(/\.[a-zA-Z0-9]+$/, "");
  return `content/${trimmed}.suggestions.json`;
}

export async function GET() {
  let toc: Toc;
  try {
    const tocFile = await getFile("content/toc.json");
    toc = JSON.parse(tocFile.content);
  } catch {
    return NextResponse.json({ articles: [], totalPending: 0 });
  }

  const articles = collectArticles(toc);

  const results = await Promise.all(
    articles.map(async (a): Promise<ArticleEntry | null> => {
      try {
        const file = await getFile(sidecarPath(a.file));
        const data = JSON.parse(file.content) as SuggestionsData;
        const list = Array.isArray(data.suggestions) ? data.suggestions : [];
        const pending = list.filter((s) => s.status === "pending");
        if (pending.length === 0) return null;
        return {
          articleFile: a.file,
          articleTitle: a.title,
          articleSlug: a.slug,
          pending: pending.length,
          previews: pending.slice(0, 3),
        };
      } catch {
        return null;
      }
    })
  );

  const filtered = results.filter((x): x is ArticleEntry => x !== null);
  const totalPending = filtered.reduce((sum, a) => sum + a.pending, 0);

  return NextResponse.json({ articles: filtered, totalPending });
}
