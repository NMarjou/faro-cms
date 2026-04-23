"use client";

import { useState, useEffect } from "react";
import type { Toc, TocCategory, TocSection, TocArticle } from "@/lib/types";

interface LinkPickerProps {
  onInsert: (href: string, text?: string) => void;
  onClose: () => void;
  selectedText?: string;
}

export default function LinkPicker({ onInsert, onClose, selectedText }: LinkPickerProps) {
  const [tab, setTab] = useState<"internal" | "external">("internal");
  const [toc, setToc] = useState<Toc | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [linkText, setLinkText] = useState(selectedText || "");

  useEffect(() => {
    fetch("/api/toc")
      .then((r) => r.json())
      .then(setToc)
      .catch(console.error);
  }, []);

  const allArticles: { article: TocArticle; category: string; section: string }[] = [];
  if (toc) {
    for (const cat of toc.categories) {
      for (const sec of cat.sections) {
        for (const art of sec.articles) {
          allArticles.push({ article: art, category: cat.name, section: sec.name });
        }
      }
    }
    for (const art of toc.articles || []) {
      allArticles.push({ article: art, category: "Uncategorized", section: "" });
    }
  }

  const filtered = searchQuery
    ? allArticles.filter((a) =>
        a.article.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allArticles;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>Insert Link</h3>
          <button onClick={onClose} className="modal-close">x</button>
        </div>

        <div style={{ display: "flex", gap: 0, marginBottom: 12 }}>
          <button
            className={`tab-btn${tab === "internal" ? " active" : ""}`}
            onClick={() => setTab("internal")}
          >
            Internal Article
          </button>
          <button
            className={`tab-btn${tab === "external" ? " active" : ""}`}
            onClick={() => setTab("external")}
          >
            External URL
          </button>
        </div>

        {tab === "internal" ? (
          <>
            <input
              className="input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search articles..."
              autoFocus
              style={{ marginBottom: 8 }}
            />
            <div
              style={{
                maxHeight: 300,
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
              }}
            >
              {filtered.map((item) => (
                <button
                  key={item.article.file}
                  onClick={() =>
                    onInsert(item.article.file, linkText || item.article.title)
                  }
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 12px",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    background: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 500 }}>{item.article.title}</div>
                  <div style={{ fontSize: 11, color: "var(--fg-muted)", display: "flex", justifyContent: "space-between" }}>
                    <span>{item.category}{item.section ? ` / ${item.section}` : ""}</span>
                    <span style={{ fontFamily: "var(--font-mono)", opacity: 0.7 }}>{item.article.file}</span>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div style={{ padding: 12, fontSize: 13, color: "var(--fg-muted)" }}>
                  No articles found
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <input
              className="input"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://..."
              autoFocus
              style={{ marginBottom: 8 }}
            />
            <input
              className="input"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder="Link text (optional)"
              style={{ marginBottom: 8 }}
            />
            <button
              onClick={() => { if (externalUrl) onInsert(externalUrl, linkText); }}
              className="btn btn-primary"
              disabled={!externalUrl}
              style={{ width: "100%" }}
            >
              Insert Link
            </button>
          </>
        )}
      </div>
    </div>
  );
}
