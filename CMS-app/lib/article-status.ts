/**
 * Single source of truth for the article workflow status.
 *
 * Status is derived from existing TOC fields — no separate `status` column
 * to keep in sync. Surfaces (list, dashboard, editor, search) call
 * `deriveArticleStatus` so they all read the same value, and use
 * `articleStatusLabel` / `articleStatusColors` to render consistently.
 *
 *   draft        — never sent for review
 *   in-review    — sent for review, awaiting either contributor passes or
 *                  tech-writer sign-off
 *   signed-off   — tech writer has flipped reviewComplete
 *   published    — publish PR has been merged (foundation field today;
 *                  flip happens via a post-merge hook we'll wire later)
 */

import type { TocArticle } from "./types";

export type ArticleStatus = "draft" | "in-review" | "signed-off" | "published";

export function deriveArticleStatus(article: TocArticle): ArticleStatus {
  // Published wins — once an article has shipped, that's the most
  // informative state regardless of any subsequent review activity. If
  // someone reopens the review (sends it for review again), the publish
  // flag should be cleared by the same hook that set it; until then
  // Published is sticky.
  if (article.published) return "published";
  if (article.reviewComplete) return "signed-off";
  if ((article.assignedTo?.length ?? 0) > 0) return "in-review";
  return "draft";
}

export function articleStatusLabel(status: ArticleStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "in-review":
      return "In review";
    case "signed-off":
      return "Signed off";
    case "published":
      return "Published";
  }
}

/**
 * Returns inline CSS values (var() references where the design system
 * defines them) so the badge looks at home in any of the surfaces it
 * appears in. Centralised here so future palette tweaks land everywhere.
 */
export function articleStatusColors(status: ArticleStatus): {
  background: string;
  color: string;
  border: string;
} {
  switch (status) {
    case "draft":
      return {
        background: "var(--bg-muted)",
        color: "var(--fg-muted)",
        border: "1px solid var(--border)",
      };
    case "in-review":
      return {
        background: "var(--warning-light)",
        color: "var(--warning)",
        border: "1px solid var(--warning)",
      };
    case "signed-off":
      return {
        background: "var(--success-light, var(--info-light))",
        color: "var(--success, var(--info))",
        border: "1px solid var(--success, var(--info))",
      };
    case "published":
      return {
        background: "var(--accent-light, var(--info-light))",
        color: "var(--accent, var(--info))",
        border: "1px solid var(--accent, var(--info))",
      };
  }
}
