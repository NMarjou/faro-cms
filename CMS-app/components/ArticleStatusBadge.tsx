"use client";

import type { TocArticle } from "@/lib/types";
import {
  articleStatusColors,
  articleStatusLabel,
  deriveArticleStatus,
  type ArticleStatus,
} from "@/lib/article-status";

interface Props {
  /** Pass either the article (preferred — handles derivation) or a status
   *  directly when you already computed it. */
  article?: Pick<TocArticle, "assignedTo" | "reviewComplete" | "published">;
  status?: ArticleStatus;
  /** Compact pill (default) vs a slightly larger size for page headers. */
  size?: "sm" | "md";
}

export default function ArticleStatusBadge({ article, status, size = "sm" }: Props) {
  const resolved: ArticleStatus = status ?? deriveArticleStatus(article || {});
  const colors = articleStatusColors(resolved);
  const padding = size === "md" ? "4px 10px" : "2px 8px";
  const fontSize = size === "md" ? 12 : 11;

  return (
    <span
      style={{
        display: "inline-block",
        padding,
        fontSize,
        fontWeight: 500,
        borderRadius: "var(--radius)",
        whiteSpace: "nowrap",
        lineHeight: 1.4,
        ...colors,
      }}
    >
      {articleStatusLabel(resolved)}
    </span>
  );
}
