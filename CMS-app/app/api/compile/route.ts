import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile } from "@/lib/storage";
import { getToc } from "@/lib/content";
import { flattenTocArticles } from "@/lib/toc-walk";
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
  /** Nested sections. The TOC allows arbitrary depth; compiled output must
   *  mirror it, or articles filed into a subsection never ship. */
  subsections?: CompiledSection[];
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

      const compileArticles = async (arts: TocArticle[]): Promise<CompiledArticle[]> => {
        const out: CompiledArticle[] = [];
        for (const art of arts) {
          try {
            const file = await getFile(`content/${art.file}`, ref);
            const { html, snippets } = await compileArticle(file.content, ref, cache, tags);
            out.push({ title: art.title, slug: art.slug, file: art.file, html, snippets });
            totalArticles++;
          } catch {
            out.push({ title: art.title, slug: art.slug, file: art.file, html: "", snippets: [] });
            totalErrors++;
          }
        }
        return out;
      };

      // Recurse into subsections — this used to stop at the top level, so any
      // article filed into a subsection was silently missing from the output.
      const compileSections = async (secs: TocSection[]): Promise<CompiledSection[]> => {
        const out: CompiledSection[] = [];
        for (const sec of secs) {
          out.push({
            name: sec.name,
            slug: sec.slug,
            articles: await compileArticles(sec.articles ?? []),
            ...(sec.subsections?.length
              ? { subsections: await compileSections(sec.subsections) }
              : {}),
          });
        }
        return out;
      };

      for (const cat of selected) {
        compiledCategories.push({
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          sections: await compileSections(cat.sections ?? []),
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
      // Includes subsections at any depth AND the uncategorised bucket, so
      // this agrees with what publish considers publishable.
      const articles = flattenTocArticles(toc);
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
