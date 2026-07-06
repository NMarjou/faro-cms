"use client";

import type { SearchObjectType, SearchResult } from "@/lib/types";
import Icon from "./Icon";
import ArticleStatusBadge from "./ArticleStatusBadge";

/** Icon + human label per object type, for the result row's leading affordance. */
export const TYPE_META: Record<SearchObjectType, { icon: string; label: string }> = {
  article: { icon: "file-text", label: "Article" },
  snippet: { icon: "scissors", label: "Snippet" },
  image: { icon: "image-square", label: "Image" },
  variable: { icon: "brackets-curly", label: "Variable" },
  glossary: { icon: "book-open", label: "Glossary" },
  condition: { icon: "tag", label: "Condition" },
  style: { icon: "palette", label: "Style" },
};

interface Props {
  result: SearchResult;
  selected?: boolean;
  /** Fired on single click (selection in the panel; open on the full page). */
  onSelect?: () => void;
  /** Fired on double click — opens the object. */
  onOpen?: () => void;
}

export default function SearchResultRow({ result, selected, onSelect, onOpen }: Props) {
  const meta = TYPE_META[result.type];
  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      title="Double-click to open"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 12px",
        borderRadius: "var(--radius)",
        cursor: "pointer",
        background: selected ? "var(--bg-secondary)" : "transparent",
        userSelect: "none",
      }}
    >
      <Icon name={meta.icon} size={16} style={{ marginTop: 2, color: "var(--fg-muted)" }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {result.title}
          </span>
          {result.type === "article" && <ArticleStatusBadge article={result} />}
        </div>
        {result.subtitle && (
          <div
            style={{
              fontSize: 12,
              color: "var(--fg-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 1,
            }}
          >
            {result.subtitle}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
          {meta.label}
        </span>
        {result.scope === "project" ? (
          <span className="badge badge-accent" title="Project-specific">project</span>
        ) : (
          <span className="badge" title="Shared across projects">shared</span>
        )}
      </div>
    </div>
  );
}
