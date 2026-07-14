import type { Toc, TocSection, TocArticle } from "./types";

/**
 * THE TOC walker. Every consumer that needs "all the articles" must go through
 * here.
 *
 * The TOC is a recursive tree — sections nest into `subsections` to any depth
 * (`/toc` lets you create them), and standalone articles live in `toc.articles`.
 * Before this, each consumer hand-rolled its own walk, and they quietly
 * disagreed:
 *
 *   • compile (by categories) iterated `cat.sections → sec.articles` and never
 *     recursed — so an article filed into a SUBSECTION was silently missing from
 *     PUBLISHED OUTPUT. No error; it just wasn't there.
 *   • compile (all) recursed, but skipped the uncategorised bucket.
 *   • publish recursed exactly ONE level, so anything at depth ≥ 2 was missed —
 *     yet it still marked those articles `published: true`. The TOC claimed an
 *     article had shipped that was never rendered.
 *
 * The duplication was the bug. One walker, one set of tests, no room to disagree.
 */

/** Every article under these sections, recursing into subsections to any depth. */
export function articlesInSections(sections: TocSection[]): TocArticle[] {
  const out: TocArticle[] = [];
  for (const sec of sections ?? []) {
    out.push(...(sec.articles ?? []));
    if (sec.subsections?.length) out.push(...articlesInSections(sec.subsections));
  }
  return out;
}

/**
 * Every article in the TOC, depth-first.
 *
 * `includeUncategorized` (default true) adds `toc.articles` — the standalone
 * bucket that newly created articles land in. Publish treats those as
 * publishable, so anything deciding "what is the content set" must include them
 * or it will disagree with publish.
 */
export function flattenTocArticles(
  toc: Toc,
  { includeUncategorized = true }: { includeUncategorized?: boolean } = {}
): TocArticle[] {
  const out: TocArticle[] = [];
  for (const cat of toc.categories ?? []) out.push(...articlesInSections(cat.sections ?? []));
  if (includeUncategorized) out.push(...(toc.articles ?? []));
  return out;
}

/** Depth-first map over a section tree, preserving nesting. Used where the
 *  STRUCTURE matters (compile emits nested sections, not a flat list). */
export function mapSectionTree<T>(
  sections: TocSection[],
  fn: (sec: TocSection, children: T[]) => T
): T[] {
  return (sections ?? []).map((sec) =>
    fn(sec, sec.subsections?.length ? mapSectionTree(sec.subsections, fn) : [])
  );
}
