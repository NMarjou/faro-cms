import { getToc, getArticle } from "./content";
import { getFile } from "./storage";
import { compileArticle, createSnippetCache } from "./compile";
import { flattenTocArticles } from "./toc-walk";
import type { Toc, TocSection, TocCategory, TocArticle } from "./types";

/**
 * The publishable bundle — the shared foundation for every deploy target
 * (the Vercel staging site, and the Zendesk sync).
 *
 * `compileArticle` resolves snippets, variables and conditionals, but its output
 * is still CMS-INTERNAL and cannot be published as-is:
 *
 *   • Images are embedded as `<img src="/api/content?path=…&raw=1">` — a URL
 *     that only exists inside this app. On any other host every image 404s.
 *     They must be re-hosted: the real bytes copied out, and the src rewritten.
 *   • Internal links are BARE SLUGS (`href="managing-goals"`) — not paths, not
 *     URLs. They must be resolved to the target's address.
 *
 * Both failures are silent (a broken image renders nothing; a bad link just goes
 * nowhere), which is why the rewriters below are pure and tested.
 */

export type SitePage = {
  /** Output path, e.g. "help/passport/getting-started.html". */
  path: string;
  title: string;
  slug: string;
  html: string;
  summary?: string;
  keywords?: string[];
  tags?: string[];
  /** Breadcrumb of category/section names. */
  trail: string[];
};

export type SiteBundle = {
  pages: SitePage[];
  /** Content-relative asset paths to copy out, e.g. "images/icons/logo.svg". */
  assets: string[];
  /** Links whose slug matched no article — surfaced rather than silently kept. */
  brokenLinks: { page: string; href: string }[];
  nav: NavCategory[];
  /** Articles that cannot be published because they aren't filed anywhere. */
  unfiled: string[];
};

export type NavNode = { name: string; slug: string; pages: { title: string; path: string }[]; children: NavNode[] };
export type NavCategory = { name: string; slug: string; description?: string; icon?: string; sections: NavNode[] };

/** Where an article lives in the built site. Mirrors its content path. */
export function outputPathFor(article: TocArticle): string {
  return article.file.replace(/\.(mdx|html?)$/i, "") + ".html";
}

/** Where an asset lives in the built site (root-relative, so it resolves from
 *  any page depth). */
export function assetUrlFor(contentPath: string): string {
  return "/" + contentPath.replace(/^\/+/, "");
}

/**
 * Rewrite CMS-internal image URLs to static asset paths, collecting what to copy.
 *
 * The markup is `<img src="/api/content?path=images%2Ficons%2Fx.svg&amp;raw=1">`
 * — URL-encoded inside an HTML-escaped query, so both layers must be undone.
 */
export function rewriteAssetUrls(
  html: string,
  toUrl: (contentPath: string) => string = assetUrlFor
): { html: string; assets: string[] } {
  const assets = new Set<string>();
  const out = html.replace(/src="\/api\/content\?([^"]*)"/g, (match, query: string) => {
    const params = new URLSearchParams(String(query).replace(/&amp;/g, "&"));
    const path = params.get("path"); // URLSearchParams decodes %2F → /
    if (!path) return match;
    // The path comes from author-authored markup and flows into a filesystem
    // read (getFileBytes) and a zip entry name. A `..` segment would escape the
    // content root; refuse it — leave the src untouched so nothing is copied.
    if (path.split("/").some((seg) => seg === "..") || path.startsWith("/")) return match;
    assets.add(path);
    return `src="${toUrl(path)}"`;
  });
  return { html: out, assets: [...assets] };
}

/**
 * Resolve bare-slug internal links to output URLs. Absolute URLs, anchors,
 * mailto/tel and already-rooted paths are left alone. An unresolvable slug is
 * reported rather than silently left as a dead link.
 */
export function rewriteInternalLinks(
  html: string,
  resolve: (slug: string) => string | null
): { html: string; broken: string[] } {
  const broken: string[] = [];
  const out = html.replace(/href="([^"]+)"/g, (match, href: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(href)) return match; // external / rooted / anchor
    // Split off any ?query/#fragment BEFORE resolving, then re-append it: the
    // resolver matches on the bare path, and dropping "#step-2" would land a deep
    // link at the top of the page instead of the target section.
    const cut = href.search(/[?#]/);
    const suffix = cut >= 0 ? href.slice(cut) : "";
    const bare = (cut >= 0 ? href.slice(0, cut) : href).replace(/^\.\//, "");
    const target = resolve(bare);
    if (!target) { broken.push(href); return match; }
    return `href="${target}${suffix}"`;
  });
  return { html: out, broken };
}

/**
 * Resolve an internal link to its output path.
 *
 * Cross-references are not written consistently, so matching only one form would
 * silently kill the rest:
 *   • the editor inserts the article's FILE PATH   (`href="help/passport/x.html"`)
 *   • older/hand-authored content uses a BARE SLUG (`href="managing-goals"`)
 * so accept file path (with or without extension), slug, and bare basename.
 */
export function buildLinkResolver(articles: TocArticle[]): (href: string) => string | null {
  const byFile = new Map<string, string>();
  const bySlug = new Map<string, string>();
  const byBase = new Map<string, string>();

  for (const a of articles) {
    const out = "/" + outputPathFor(a);
    const noExt = a.file.replace(/\.(mdx|html?)$/i, "");
    byFile.set(a.file, out);
    byFile.set(noExt, out);
    bySlug.set(a.slug, out);
    byBase.set((noExt.split("/").pop() ?? noExt), out);
  }

  return (href: string) => {
    const clean = href.replace(/^\.\//, "").split(/[?#]/)[0];
    const noExt = clean.replace(/\.(mdx|html?)$/i, "");
    return (
      byFile.get(clean) ??
      byFile.get(noExt) ??
      bySlug.get(clean) ??
      bySlug.get(noExt) ??
      byBase.get(noExt) ??
      null
    );
  };
}

/** Nav tree mirroring the TOC (categories → sections → subsections, any depth). */
function buildNav(toc: Toc): NavCategory[] {
  const sectionNode = (sec: TocSection): NavNode => ({
    name: sec.name,
    slug: sec.slug,
    pages: (sec.articles ?? []).map((a) => ({ title: a.title, path: outputPathFor(a) })),
    children: (sec.subsections ?? []).map(sectionNode),
  });
  return (toc.categories ?? []).map((cat: TocCategory) => ({
    name: cat.name,
    slug: cat.slug,
    description: cat.description || undefined,
    icon: cat.icon,
    sections: (cat.sections ?? []).map(sectionNode),
  }));
}

/** Breadcrumb trail per article file, so pages can show where they live. */
function buildTrails(toc: Toc): Map<string, string[]> {
  const trails = new Map<string, string[]>();
  const walk = (secs: TocSection[], trail: string[]) => {
    for (const sec of secs ?? []) {
      const here = [...trail, sec.name];
      for (const a of sec.articles ?? []) trails.set(a.file, here);
      if (sec.subsections) walk(sec.subsections, here);
    }
  };
  for (const cat of toc.categories ?? []) walk(cat.sections ?? [], [cat.name]);
  return trails;
}

/**
 * Build the publishable bundle for the current project.
 *
 * `activeTags` picks the audience: conditional content whose tags don't match is
 * stripped (see resolveConditionals). Passing none keeps everything.
 */
export async function buildSiteBundle(
  { activeTags, ref }: { activeTags?: string[]; ref?: string } = {}
): Promise<SiteBundle> {
  const toc = await getToc(ref);
  const cache = createSnippetCache();

  // Uncategorised articles have nowhere to live in a published site — and in
  // Zendesk an article cannot sit directly under a category at all. Report them
  // rather than emitting orphan pages.
  const unfiled = (toc.articles ?? []).map((a) => a.file);

  const filed = flattenTocArticles(toc, { includeUncategorized: false });
  const resolveLink = buildLinkResolver(filed);

  const trails = buildTrails(toc);
  const pages: SitePage[] = [];
  const assets = new Set<string>();
  const brokenLinks: { page: string; href: string }[] = [];

  for (const article of filed) {
    let html: string;
    try {
      const file = await getFile(`content/${article.file}`, ref);
      ({ html } = await compileArticle(file.content, ref, cache, activeTags));
    } catch {
      continue; // unreadable body — skip rather than emit a broken page
    }

    const withAssets = rewriteAssetUrls(html);
    withAssets.assets.forEach((a) => assets.add(a));

    const withLinks = rewriteInternalLinks(withAssets.html, resolveLink);
    const path = outputPathFor(article);
    withLinks.broken.forEach((href) => brokenLinks.push({ page: path, href }));

    pages.push({
      path,
      title: article.title,
      slug: article.slug,
      html: withLinks.html,
      summary: article.summary,
      keywords: article.keywords,
      tags: article.tags,
      trail: trails.get(article.file) ?? [],
    });
  }

  return { pages, assets: [...assets], brokenLinks, nav: buildNav(toc), unfiled };
}
