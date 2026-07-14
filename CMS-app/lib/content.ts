import matter from "gray-matter";
import type {
  Toc,
  TocCategory,
  TocSection,
  TocArticle,
  Article,
  ArticleFrontmatter,
  Variables,
  ConditionsConfig,
  Snippet,
} from "./types";
import { getFile } from "./storage";
import { loadMergedVariablesFlat, loadMergedConditions } from "./merged-config";
import { flattenTocArticles } from "./toc-walk";

const CONTENT_BASE = "content";

// ── TOC ──

export async function getToc(ref?: string): Promise<Toc> {
  const file = await getFile(`${CONTENT_BASE}/toc.json`, ref);
  return JSON.parse(file.content);
}

export async function getCategories(ref?: string): Promise<TocCategory[]> {
  const toc = await getToc(ref);
  return toc.categories;
}

export async function getCategory(
  slug: string,
  ref?: string
): Promise<TocCategory | undefined> {
  const categories = await getCategories(ref);
  return categories.find((c) => c.slug === slug);
}

export async function getSection(
  sectionSlug: string,
  ref?: string
): Promise<{ section: TocSection; category: TocCategory } | undefined> {
  const categories = await getCategories(ref);
  for (const category of categories) {
    const section = findSection(category.sections, sectionSlug);
    if (section) return { section, category };
  }
  return undefined;
}

function findSection(
  sections: TocSection[],
  slug: string
): TocSection | undefined {
  for (const section of sections) {
    if (section.slug === slug) return section;
    if (section.subsections) {
      const found = findSection(section.subsections, slug);
      if (found) return found;
    }
  }
  return undefined;
}

export function findArticleInToc(
  toc: Toc,
  articleSlug: string
): { article: TocArticle; section: TocSection; category: TocCategory } | undefined {
  for (const category of toc.categories) {
    const result = findArticleInSections(category.sections, articleSlug, category);
    if (result) return result;
  }
  return undefined;
}

function findArticleInSections(
  sections: TocSection[],
  slug: string,
  category: TocCategory
): { article: TocArticle; section: TocSection; category: TocCategory } | undefined {
  for (const section of sections) {
    const article = section.articles.find((a) => a.slug === slug);
    if (article) return { article, section, category };
    if (section.subsections) {
      const found = findArticleInSections(section.subsections, slug, category);
      if (found) return found;
    }
  }
  return undefined;
}

// ── Articles ──

export async function getArticle(
  filePath: string,
  ref?: string
): Promise<Article> {
  const file = await getFile(`${CONTENT_BASE}/${filePath}`, ref);
  const { data, content } = matter(file.content);
  return {
    frontmatter: data as ArticleFrontmatter,
    content,
    filePath,
  };
}

/** @deprecated Use `flattenTocArticles` from lib/toc-walk directly. */
export function getAllArticlesFromToc(toc: Toc): TocArticle[] {
  return flattenTocArticles(toc);
}

// ── Variables ──

export async function getVariables(ref?: string): Promise<Variables> {
  // Merges the current project's overlay over the shared sets (flattened), so
  // compiled/published output uses the project's variable values.
  return loadMergedVariablesFlat(ref);
}

// ── Conditions ──

export async function getConditions(ref?: string): Promise<ConditionsConfig> {
  // Merges the current project's overlay over shared, so conditional filtering
  // during compile/publish honors the project's tags.
  try {
    return (await loadMergedConditions(ref)).merged;
  } catch {
    return { tags: [] };
  }
}

// ── Snippets ──

export async function getSnippet(
  name: string,
  ref?: string
): Promise<Snippet> {
  // Try .html first, then fall back to .mdx
  for (const ext of [".html", ".mdx"]) {
    const filePath = `snippets/${name}${ext}`;
    try {
      const file = await getFile(`${CONTENT_BASE}/${filePath}`, ref);
      let content: string;
      if (ext === ".mdx") {
        content = matter(file.content).content;
      } else {
        // Strip the <!--name:...--> comment from HTML snippets
        content = file.content.replace(/<!--\s*name:\s*.+?\s*-->\n?/, "");
      }
      return { name, file: filePath, content };
    } catch {
      continue;
    }
  }
  throw new Error(`Snippet not found: ${name}`);
}
