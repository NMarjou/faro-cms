import { getToc, getArticle } from "./content";
import { parseTags } from "./compile";
import { flattenTocArticles } from "./toc-walk";
import type { Toc } from "./types";

/**
 * "Where used" for condition tags — the safety net for deleting one.
 *
 * A condition is used in TWO independent places:
 *   1. as an article LABEL (TocArticle.tags), and
 *   2. INLINE in article bodies (data-tags on conditional blocks/marks), which
 *      is what compile actually filters on.
 *
 * Deleting a tag that is still used inline is destructive and silent: the tag
 * can no longer be selected as an active audience, so `resolveConditionals`
 * strips that content from EVERY published build. It doesn't error — the content
 * just disappears. Hence this: the manager must show usage before offering
 * delete.
 *
 * Tag values are read with compile's own `parseTags`, so the entity-escaped
 * markup the editor writes (data-tags="[&quot;x&quot;]") is decoded exactly the
 * same way here as at compile time. Duplicating that logic is how it drifted the
 * first time.
 */

export type ArticleRef = { file: string; title: string };

export type ConditionUsage = {
  /** Articles carrying this tag as a label. */
  labels: ArticleRef[];
  /** Articles whose body contains conditional content gated on this tag. */
  inline: ArticleRef[];
};

/** Every conditional opening tag in a body (block divs and inline spans). */
const CONDITIONAL_TAG = /<(?:div|span)\b[^>]*data-(?:node-type|mark-type)="conditional"[^>]*>/gi;

/** Usage of every condition tag across the current project, keyed by tag. */
export async function buildConditionUsage(): Promise<Record<string, ConditionUsage>> {
  const usage: Record<string, ConditionUsage> = {};
  const bucket = (tag: string): ConditionUsage =>
    (usage[tag] ??= { labels: [], inline: [] });

  let toc: Toc;
  try {
    toc = await getToc();
  } catch {
    return usage;
  }

  for (const article of flattenTocArticles(toc)) {
    const ref: ArticleRef = { file: article.file, title: article.title };

    for (const tag of article.tags ?? []) bucket(tag).labels.push(ref);

    try {
      const body = (await getArticle(article.file)).content;
      const seen = new Set<string>(); // one entry per article, not per occurrence
      for (const openTag of body.match(CONDITIONAL_TAG) ?? []) {
        for (const tag of parseTags(openTag) ?? []) {
          if (seen.has(tag)) continue;
          seen.add(tag);
          bucket(tag).inline.push(ref);
        }
      }
    } catch {
      /* unreadable body — skip, don't fail the whole report */
    }
  }

  return usage;
}
