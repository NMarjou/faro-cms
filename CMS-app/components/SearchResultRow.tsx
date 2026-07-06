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

/** Types whose bodyText is long-form prose worth previewing (short-body types
 *  like variables/glossary already surface their value/definition in subtitle). */
const PREVIEWABLE = new Set<SearchObjectType>(["article", "snippet"]);

/** A window of body text around the first case-insensitive occurrence of the
 *  query, split so the match can be emphasized. Null when the query isn't a
 *  literal substring of the body (e.g. a fuzzy title-only match). */
function buildExcerpt(
  body: string,
  query: string
): { before: string; match: string; after: string } | null {
  const q = query.trim();
  if (q.length < 2) return null;
  const idx = body.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - 32);
  const end = Math.min(body.length, idx + q.length + 64);
  return {
    before: (start > 0 ? "… " : "") + body.slice(start, idx),
    match: body.slice(idx, idx + q.length),
    after: body.slice(idx + q.length, end) + (end < body.length ? " …" : ""),
  };
}

interface Props {
  result: SearchResult;
  selected?: boolean;
  /** The active query — used to render a match preview from the body text. */
  query?: string;
  /** Fired on single click (selection in the panel; open on the full page). */
  onSelect?: () => void;
  /** Fired on double click — opens the object. */
  onOpen?: () => void;
}

export default function SearchResultRow({ result, selected, query, onSelect, onOpen }: Props) {
  const meta = TYPE_META[result.type];
  const excerpt =
    query && result.bodyText && PREVIEWABLE.has(result.type)
      ? buildExcerpt(result.bodyText, query)
      : null;
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
        {excerpt && (
          <div
            style={{
              fontSize: 12,
              color: "var(--fg-muted)",
              marginTop: 3,
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {excerpt.before}
            <mark style={{ background: "var(--accent-light)", color: "var(--fg)", fontWeight: 500, padding: "0 1px", borderRadius: 2 }}>
              {excerpt.match}
            </mark>
            {excerpt.after}
          </div>
        )}
        {result.type === "article" && result.tags && result.tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {result.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  color: "var(--fg-muted)",
                }}
              >
                {tag}
              </span>
            ))}
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
