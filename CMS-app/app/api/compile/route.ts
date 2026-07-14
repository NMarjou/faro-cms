import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile } from "@/lib/storage";
import { getToc, getAllArticlesFromToc } from "@/lib/content";
import { compileArticle, createSnippetCache } from "@/lib/compile";
import type { TocCategory, TocSection, TocArticle } from "@/lib/types";

interface CompiledArticle {
  title: string;
  slug: string;
  file: string;
  html: string;
  snippets: string[];
}

interface CompiledSection {
  name: string;
  slug: string;
  articles: CompiledArticle[];
}

interface CompiledCategory {
  name: string;
  slug: string;
  description: string;
  sections: CompiledSection[];
}

/**
 * POST /api/compile
 *
 * Single article:   { path: "help/passport/overview.mdx", ref?: string }
 * Batch (all):      { all: true, ref?: string }
 * By categories:    { categories: ["help", "apis"], ref?: string }
 */
export async function POST(request: NextRequest) {
  await setRequestProject(request);
  try {
    const body = await request.json();
    const { path, all, categories: categorySlugs, ref, activeTags } = body;
    const cache = createSnippetCache();
    const tags: string[] | undefined = Array.isArray(activeTags) ? activeTags : undefined;

    // ── Compile by selected categories ──
    if (categorySlugs && Array.isArray(categorySlugs)) {
      const toc = await getToc(ref);
      const selected = toc.categories.filter((cat: TocCategory) =>
        categorySlugs.includes(cat.slug)
      );

      const compiledCategories: CompiledCategory[] = [];
      let totalArticles = 0;
      let totalErrors = 0;

      for (const cat of selected) {
        const compiledSections: CompiledSection[] = [];

        for (const sec of cat.sections) {
          const compiledArticles: CompiledArticle[] = [];

          for (const art of sec.articles) {
            try {
              const file = await getFile(`content/${art.file}`, ref);
              const { html, snippets } = await compileArticle(file.content, ref, cache, tags);
              compiledArticles.push({ title: art.title, slug: art.slug, file: art.file, html, snippets });
              totalArticles++;
            } catch {
              compiledArticles.push({ title: art.title, slug: art.slug, file: art.file, html: "", snippets: [] });
              totalErrors++;
            }
          }

          compiledSections.push({ name: sec.name, slug: sec.slug, articles: compiledArticles });
        }

        compiledCategories.push({
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          sections: compiledSections,
        });
      }

      return NextResponse.json({
        categories: compiledCategories,
        stats: { totalArticles, totalErrors, totalCategories: compiledCategories.length },
      });
    }

    // ── Batch compile all ──
    if (all) {
      const toc = await getToc(ref);
      const articles = getAllArticlesFromToc(toc);
      const results: { path: string; html: string; snippets: string[] }[] = [];

      for (const article of articles) {
        try {
          const file = await getFile(`content/${article.file}`, ref);
          const { html, snippets } = await compileArticle(file.content, ref, cache, tags);
          results.push({ path: article.file, html, snippets });
        } catch {
          results.push({ path: article.file, html: "", snippets: [] });
        }
      }

      return NextResponse.json({ results });
    }

    // ── Single article compile ──
    if (!path) {
      return NextResponse.json(
        { error: "path, categories, or all is required" },
        { status: 400 }
      );
    }

    const file = await getFile(`content/${path}`, ref);
    const { html, snippets } = await compileArticle(file.content, ref, undefined, tags);

    return NextResponse.json({ html, snippets });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Compilation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
