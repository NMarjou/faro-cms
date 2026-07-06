/**
 * Unified, project-scoped search index across every content object type.
 *
 * Search is contextual to the current project but includes shared objects: the
 * merged loaders (variables/glossary/conditions/styles) and `listOverridable`
 * (snippets/images) already union shared + project, and each hit carries its
 * `scope`. Articles are project-scoped by construction (they live under
 * `projects/<slug>/`). Every object contributes its NAME (always searchable);
 * types that have prose also contribute stripped `bodyText` for full-text.
 *
 * The heavy lifting (reading every article body, etc.) is why callers cache the
 * built Fuse index per project — see `app/api/search/route.ts`.
 */

import matter from "gray-matter";
import { getToc, getArticle } from "./content";
import { listOverridable, getFile } from "./storage";
import {
  loadMergedVariableSets,
  loadMergedGlossary,
  loadMergedConditions,
  loadMergedStyles,
} from "./merged-config";
import type { Toc, TocCategory, TocSection, TocArticle, SearchResult } from "./types";

/**
 * Deep link to a config-object's management page that scrolls to and flashes
 * the specific entry. `key` identifies the row (matched against
 * `data-highlight-id`); `scope` picks the shared/project view it lives in.
 */
function deepLink(page: string, key: string, scope: "shared" | "project"): string {
  return `${page}?highlight=${encodeURIComponent(key)}&scope=${scope}`;
}

/** Collapse HTML/MDX to plain, searchable text. */
function stripToText(src: string): string {
  return src
    .replace(/<[^>]+>/g, " ") // strip HTML/JSX tags
    .replace(/\{[^}]+\}/g, " ") // strip MDX expressions
    .replace(/[#*_~`>|-]/g, " ") // strip markdown punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/** Snippet display name: HTML `<!--name:-->`, MDX frontmatter `name`, else basename. */
function snippetName(content: string, filePath: string): string {
  const html = content.match(/<!--\s*name:\s*(.+?)\s*-->/);
  if (html) return html[1];
  try {
    const { data } = matter(content);
    if (data.name) return String(data.name);
  } catch {
    /* not MDX */
  }
  return (filePath.split("/").pop() || filePath).replace(/\.(html|mdx)$/, "");
}

/** Snippet body without its name marker/frontmatter, stripped to text. */
function snippetBody(content: string): string {
  const noComment = content.replace(/<!--\s*name:\s*.+?\s*-->\n?/, "");
  let body = noComment;
  try {
    body = matter(noComment).content;
  } catch {
    /* not MDX */
  }
  return stripToText(body);
}

/** Parent folder (content-relative, minus the `snippets/`|`images/` root). */
function folderOf(rel: string, root: string): string {
  const parts = rel.replace(new RegExp(`^${root}/`), "").split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

/** Walk the TOC (categories → sections → subsections, plus loose articles),
 *  yielding each article with its category/section display context. */
function collectArticles(
  toc: Toc
): { article: TocArticle; context: string }[] {
  const out: { article: TocArticle; context: string }[] = [];
  const walkSections = (sections: TocSection[], cat: TocCategory, trail: string[]) => {
    for (const section of sections) {
      const path = [...trail, section.name];
      for (const article of section.articles) {
        out.push({ article, context: [cat.name, ...path].filter(Boolean).join(" › ") });
      }
      if (section.subsections) walkSections(section.subsections, cat, path);
    }
  };
  for (const cat of toc.categories) walkSections(cat.sections, cat, []);
  for (const article of toc.articles ?? []) out.push({ article, context: "" });
  return out;
}

/** Build the full unified result set for the CURRENT project (shared included). */
export async function buildSearchIndex(): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  // Articles — project-scoped; full text from the body.
  try {
    const toc = await getToc();
    for (const { article, context } of collectArticles(toc)) {
      try {
        const full = await getArticle(article.file);
        results.push({
          type: "article",
          id: `article:${article.file}`,
          title: full.frontmatter.title || article.title,
          subtitle: context || undefined,
          bodyText: stripToText(full.content),
          scope: "project",
          href: `/editor/${encodeURIComponent(article.file)}`,
          assignedTo: article.assignedTo,
          reviewComplete: article.reviewComplete,
          published: article.published,
          tags: article.tags,
        });
      } catch {
        /* skip unreadable article body */
      }
    }
  } catch {
    /* no TOC yet */
  }

  // Snippets — merged shared + project; full text from the body.
  try {
    for (const { file, scope } of await listOverridable("content/snippets")) {
      if (!/\.(mdx|html)$/.test(file)) continue;
      const rel = file.replace(/^content\//, "");
      try {
        const f = await getFile(file);
        results.push({
          type: "snippet",
          id: `snippet:${rel}`,
          title: snippetName(f.content, file),
          subtitle: folderOf(rel, "snippets") || undefined,
          bodyText: snippetBody(f.content),
          scope,
          href: `/editor/${encodeURIComponent(rel)}`,
        });
      } catch {
        /* skip unreadable snippet */
      }
    }
  } catch {
    /* no snippets dir */
  }

  // Images — merged shared + project; name-only (filename).
  try {
    for (const { file, scope } of await listOverridable("content/images")) {
      if (!/\.(png|jpe?g|gif|svg|webp)$/i.test(file)) continue;
      const rel = file.replace(/^content\//, "");
      results.push({
        type: "image",
        id: `image:${rel}`,
        title: file.split("/").pop() || rel,
        subtitle: folderOf(rel, "images") || undefined,
        scope,
        // Opens the image's folder and preview modal on the Images page.
        href: `/images?highlight=${encodeURIComponent(rel)}`,
      });
    }
  } catch {
    /* no images dir */
  }

  // Variables — merged; name = key, value contributes full text.
  try {
    const { merged, scopes } = await loadMergedVariableSets();
    for (const set of merged.sets) {
      for (const [key, value] of Object.entries(set.variables)) {
        results.push({
          type: "variable",
          id: `variable:${set.slug}.${key}`,
          title: key,
          subtitle: `${set.name} · ${value}`,
          bodyText: String(value),
          scope: scopes[set.slug]?.[key] ?? "shared",
          href: deepLink("/variables", `${set.slug}.${key}`, scopes[set.slug]?.[key] ?? "shared"),
        });
      }
    }
  } catch {
    /* no variables */
  }

  // Glossary — merged; name = term, definition contributes full text.
  try {
    const { merged, scopes } = await loadMergedGlossary();
    for (const t of merged.terms) {
      results.push({
        type: "glossary",
        id: `glossary:${t.term}`,
        title: t.term,
        subtitle: t.definition.slice(0, 100),
        bodyText: t.definition,
        scope: scopes[t.term] ?? "shared",
        href: deepLink("/glossary", t.term, scopes[t.term] ?? "shared"),
      });
    }
  } catch {
    /* no glossary */
  }

  // Conditions — merged; name-only (tag). No dedicated page → open the TOC,
  // where tags are applied to articles.
  try {
    const { merged, scopes } = await loadMergedConditions();
    for (const tag of merged.tags) {
      results.push({
        type: "condition",
        id: `condition:${tag}`,
        title: tag,
        scope: scopes[tag] ?? "shared",
        href: "/toc",
      });
    }
  } catch {
    /* no conditions */
  }

  // Styles — merged; name + class searchable.
  try {
    const { merged, scopes } = await loadMergedStyles();
    for (const s of merged) {
      results.push({
        type: "style",
        id: `style:${s.class}`,
        title: s.name,
        subtitle: `.${s.class}${s.element ? ` · ${s.element}` : ""}`,
        scope: scopes[s.class] ?? "shared",
        href: deepLink("/styles", s.class, scopes[s.class] ?? "shared"),
      });
    }
  } catch {
    /* no styles */
  }

  return results;
}
