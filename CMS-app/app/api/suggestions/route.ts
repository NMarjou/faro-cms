import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile } from "@/lib/storage";
import type { Suggestion, SuggestionsData, Toc, TocArticle } from "@/lib/types";

/**
 * GET /api/suggestions
 *
 * Cross-article rollup for the tech-writer review queue. For every article
 * in the TOC, opens the sidecar in parallel and reports anything that needs
 * the tech writer's attention:
 *
 *   - **pending** > 0: contributor suggestions waiting for accept/reject
 *   - **needsSignoff** true: article was sent for review and the tech
 *     writer hasn't flipped the article-level `reviewComplete` flag yet.
 *
 * Returns:
 *   {
 *     articles: [{
 *       articleFile, articleTitle, articleSlug,
 *       pending, previews,
 *       needsSignoff, assignedCount, reviewsDoneCount
 *     }],
 *     totalPending: number,
 *     totalSignoffs: number,
 *   }
 */

interface ArticleEntry {
  articleFile: string;
  articleTitle: string;
  articleSlug: string;
  pending: number;
  previews: Suggestion[];
  needsSignoff: boolean;
  assignedCount: number;
  reviewsDoneCount: number;
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

export async function GET(request: NextRequest) {
  await setRequestProject(request);
  let toc: Toc;
  try {
    const tocFile = await getFile("content/toc.json");
    toc = JSON.parse(tocFile.content);
  } catch {
    return NextResponse.json({ articles: [], totalPending: 0, totalSignoffs: 0 });
  }

  const articles = collectArticles(toc);

  const results = await Promise.all(
    articles.map(async (a): Promise<ArticleEntry | null> => {
      const assignedCount = (a.assignedTo || []).length;
      const reviewsDoneCount = (a.reviewsDone || []).length;
      const needsSignoff = assignedCount > 0 && a.reviewComplete !== true;

      let pending = 0;
      let previews: Suggestion[] = [];
      try {
        const file = await getFile(sidecarPath(a.file));
        const data = JSON.parse(file.content) as SuggestionsData;
        const list = Array.isArray(data.suggestions) ? data.suggestions : [];
        const pendingList = list.filter((s) => s.status === "pending");
        pending = pendingList.length;
        previews = pendingList.slice(0, 3);
      } catch {
        /* no sidecar — pending stays 0 */
      }

      if (pending === 0 && !needsSignoff) return null;
      return {
        articleFile: a.file,
        articleTitle: a.title,
        articleSlug: a.slug,
        pending,
        previews,
        needsSignoff,
        assignedCount,
        reviewsDoneCount,
      };
    })
  );

  const filtered = results.filter((x): x is ArticleEntry => x !== null);
  const totalPending = filtered.reduce((sum, a) => sum + a.pending, 0);
  const totalSignoffs = filtered.filter((a) => a.needsSignoff).length;

  return NextResponse.json({ articles: filtered, totalPending, totalSignoffs });
}
