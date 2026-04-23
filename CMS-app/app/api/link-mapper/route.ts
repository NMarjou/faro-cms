import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile, listFilesRecursive } from "@/lib/storage";
import type { Toc, TocSection } from "@/lib/types";

// ─── Types ──────────────────────────────────────────────────────────
interface UnresolvedLink {
  sourceFile: string;
  sourceTitle: string;
  linkText: string;
  originalHref: string;
  suggestedSlug: string | null;
  suggestedTitle: string | null;
  lineSnippet: string;
}

interface ArticleEntry {
  file: string;
  title: string;
  slug: string;
}

// ─── Helpers ────────────────────────────────────────────────────────
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Collect all articles from TOC into flat list */
function collectArticles(toc: Toc): ArticleEntry[] {
  const articles: ArticleEntry[] = [];
  for (const cat of toc.categories) {
    const walk = (sections: TocSection[]) => {
      for (const sec of sections) {
        for (const art of sec.articles) {
          articles.push({ file: art.file, title: art.title, slug: art.slug });
        }
        if (sec.subsections) walk(sec.subsections);
      }
    };
    walk(cat.sections);
  }
  for (const art of toc.articles || []) {
    articles.push({ file: art.file, title: art.title, slug: art.slug });
  }
  return articles;
}

/** Try to auto-match a Flare-style href to a CMS article */
function autoMatch(href: string, articles: ArticleEntry[]): ArticleEntry | null {
  // Normalize the href
  const normalized = href
    .replace(/^\.\.?\//g, "")          // strip leading ./  ../
    .replace(/^\/Content\//i, "")      // strip Flare /Content/ prefix
    .replace(/#.*$/, "")               // strip anchor
    .replace(/\?.*$/, "");             // strip query params

  if (!normalized) return null;

  // Extract just the filename without extension
  const parts = normalized.split("/");
  const filename = parts[parts.length - 1] || "";
  const stem = filename.replace(/\.[^.]+$/, "");
  const stemSlug = slugify(stem);

  if (!stemSlug) return null;

  // 1. Exact slug match
  const exactSlug = articles.find((a) => a.slug === stemSlug);
  if (exactSlug) return exactSlug;

  // 2. Slug contained in file path
  const pathMatch = articles.find((a) => a.file.includes(stemSlug));
  if (pathMatch) return pathMatch;

  // 3. File stem contained in article slug
  const reverseMatch = articles.find((a) => a.slug.includes(stemSlug) || stemSlug.includes(a.slug));
  if (reverseMatch) return reverseMatch;

  // 4. Title similarity — slugified title contains stem
  const titleMatch = articles.find((a) => {
    const titleSlug = slugify(a.title);
    return titleSlug === stemSlug || titleSlug.includes(stemSlug) || stemSlug.includes(titleSlug);
  });
  if (titleMatch) return titleMatch;

  return null;
}

/** Check if an href looks like an internal/relative link (not external) */
function isInternalLink(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("http://") || href.startsWith("https://")) return false;
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return false;
  if (href.startsWith("javascript:")) return false;
  if (href.startsWith("#")) return false; // pure anchor
  return true;
}

// ─── GET: Scan all articles for unresolved links ────────────────────
export async function GET() {
  try {
    const tocFile = await getFile("content/toc.json");
    const toc: Toc = JSON.parse(tocFile.content);
    const articles = collectArticles(toc);
    const unresolvedLinks: UnresolvedLink[] = [];

    // Build a set of known article files for quick lookup
    const knownFiles = new Set(articles.map((a) => a.file));
    const knownSlugs = new Set(articles.map((a) => a.slug));

    // Scan each article
    for (const article of articles) {
      let content: string;
      try {
        const file = await getFile(`content/${article.file}`);
        content = file.content;
      } catch {
        continue; // file not found, skip
      }

      // Find HTML <a href="..."> links
      const htmlLinkRegex = /<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = htmlLinkRegex.exec(content)) !== null) {
        const href = match[1];
        const linkText = match[2].replace(/<[^>]+>/g, "").trim();
        if (!isInternalLink(href)) continue;

        // Check if this link resolves to a known CMS article
        const hrefClean = href.replace(/#.*$/, "").replace(/\?.*$/, "");
        const isResolved = knownFiles.has(hrefClean) || knownSlugs.has(slugify(hrefClean.replace(/\.[^.]+$/, "").split("/").pop() || ""));

        if (!isResolved) {
          const suggestion = autoMatch(href, articles);
          // Get surrounding context
          const idx = match.index;
          const start = Math.max(0, content.lastIndexOf("\n", idx) + 1);
          const end = content.indexOf("\n", idx + match[0].length);
          const lineSnippet = content.substring(start, end > 0 ? end : idx + match[0].length).trim().substring(0, 200);

          unresolvedLinks.push({
            sourceFile: article.file,
            sourceTitle: article.title,
            linkText,
            originalHref: href,
            suggestedSlug: suggestion?.slug || null,
            suggestedTitle: suggestion?.title || null,
            lineSnippet,
          });
        }
      }

      // Find markdown [text](href) links
      const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      while ((match = mdLinkRegex.exec(content)) !== null) {
        const linkText = match[1];
        const href = match[2];
        if (!isInternalLink(href)) continue;

        const hrefClean = href.replace(/#.*$/, "").replace(/\?.*$/, "");
        const isResolved = knownFiles.has(hrefClean) || knownSlugs.has(slugify(hrefClean.replace(/\.[^.]+$/, "").split("/").pop() || ""));

        if (!isResolved) {
          const suggestion = autoMatch(href, articles);
          const idx = match.index;
          const start = Math.max(0, content.lastIndexOf("\n", idx) + 1);
          const end = content.indexOf("\n", idx + match[0].length);
          const lineSnippet = content.substring(start, end > 0 ? end : idx + match[0].length).trim().substring(0, 200);

          unresolvedLinks.push({
            sourceFile: article.file,
            sourceTitle: article.title,
            linkText,
            originalHref: href,
            suggestedSlug: suggestion?.slug || null,
            suggestedTitle: suggestion?.title || null,
            lineSnippet,
          });
        }
      }
    }

    return NextResponse.json({
      unresolvedLinks,
      articles: articles.map((a) => ({ slug: a.slug, title: a.title, file: a.file })),
      stats: {
        totalArticlesScanned: articles.length,
        totalUnresolvedLinks: unresolvedLinks.length,
        autoMatchedLinks: unresolvedLinks.filter((l) => l.suggestedSlug).length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Link scan failed" },
      { status: 500 }
    );
  }
}

// ─── POST: Apply link mappings ──────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mappings } = body as {
      mappings: { sourceFile: string; originalHref: string; targetSlug: string }[];
    };

    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      return NextResponse.json({ error: "No mappings provided" }, { status: 400 });
    }

    // Load TOC to build slug → file map
    const tocFile = await getFile("content/toc.json");
    const toc: Toc = JSON.parse(tocFile.content);
    const articles = collectArticles(toc);
    const slugToFile: Record<string, string> = {};
    for (const a of articles) {
      slugToFile[a.slug] = a.file;
    }

    // Group mappings by source file
    const byFile: Record<string, { originalHref: string; targetSlug: string }[]> = {};
    for (const m of mappings) {
      if (!byFile[m.sourceFile]) byFile[m.sourceFile] = [];
      byFile[m.sourceFile].push({ originalHref: m.originalHref, targetSlug: m.targetSlug });
    }

    let filesUpdated = 0;
    let linksRewritten = 0;

    for (const [sourceFile, fileMappings] of Object.entries(byFile)) {
      let file;
      try {
        file = await getFile(`content/${sourceFile}`);
      } catch {
        continue;
      }

      let content = file.content;
      let changed = false;

      for (const mapping of fileMappings) {
        const targetFile = slugToFile[mapping.targetSlug];
        if (!targetFile) continue;

        // Build the CMS link path (relative, without content/ prefix)
        const newHref = targetFile;

        // Replace in HTML links
        const htmlPattern = new RegExp(
          `(<a\\s+[^>]*href=")${escapeRegex(mapping.originalHref)}("[^>]*>)`,
          "gi"
        );
        const htmlReplaced = content.replace(htmlPattern, `$1${newHref}$2`);

        // Replace in markdown links
        const mdPattern = new RegExp(
          `(\\[[^\\]]+\\]\\()${escapeRegex(mapping.originalHref)}(\\))`,
          "g"
        );
        const mdReplaced = htmlReplaced.replace(mdPattern, `$1${newHref}$2`);

        if (mdReplaced !== content) {
          content = mdReplaced;
          changed = true;
          linksRewritten++;
        }
      }

      if (changed) {
        await putFile(
          `content/${sourceFile}`,
          content,
          `Link mapper: rewrite links in ${sourceFile}`
        );
        filesUpdated++;
      }
    }

    return NextResponse.json({
      success: true,
      filesUpdated,
      linksRewritten,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Link mapping failed" },
      { status: 500 }
    );
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
