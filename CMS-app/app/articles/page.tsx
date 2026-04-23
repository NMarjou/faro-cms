"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Toc, TocCategory, TocArticle } from "@/lib/types";

export default function ArticlesPage() {
  const [toc, setToc] = useState<Toc | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  );
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    fetch("/api/toc")
      .then((r) => r.json())
      .then((data) => {
        setToc(data);
        // Expand all categories by default
        if (data.categories) {
          setExpandedCategories(
            new Set(data.categories.map((c: TocCategory) => c.slug))
          );
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const toggleCategory = (slug: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const toggleSection = (slug: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const countArticles = (toc: Toc): number => {
    let count = 0;
    for (const cat of toc.categories) {
      for (const sec of cat.sections) {
        count += sec.articles.length;
      }
    }
    return count;
  };

  return (
    <>
      <header className="main-header">
        <h1>Articles</h1>
        <Link href="/articles/new" className="btn btn-primary">
          New Article
        </Link>
      </header>
      <div className="main-body">
        {loading && <p>Loading articles...</p>}
        {!loading && !toc && (
          <div className="empty-state">
            <h3>No content found</h3>
            <p>
              Set up your content/toc.json or run the migration script to get
              started.
            </p>
          </div>
        )}
        {toc && (
          <>
            <p style={{ color: "var(--fg-muted)", marginBottom: 16 }}>
              {countArticles(toc)} articles across {toc.categories.length}{" "}
              categories
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {toc.categories.map((category) => (
                <div key={category.slug}>
                  <button
                    onClick={() => toggleCategory(category.slug)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "10px 12px",
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      fontSize: 15,
                      fontWeight: 600,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        transform: expandedCategories.has(category.slug)
                          ? "rotate(90deg)"
                          : "none",
                        transition: "transform 0.15s",
                      }}
                    >
                      ▶
                    </span>
                    {category.name}
                    <span className="badge" style={{ marginLeft: "auto" }}>
                      {category.sections.reduce(
                        (n, s) => n + s.articles.length,
                        0
                      )}
                    </span>
                  </button>
                  {expandedCategories.has(category.slug) && (
                    <div style={{ paddingLeft: 20, marginTop: 4 }}>
                      {category.sections.map((section) => (
                        <div key={section.slug} style={{ marginBottom: 4 }}>
                          <button
                            onClick={() => toggleSection(section.slug)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              width: "100%",
                              padding: "8px 12px",
                              background: "none",
                              border: "none",
                              fontSize: 14,
                              fontWeight: 500,
                              cursor: "pointer",
                              textAlign: "left",
                              color: "var(--fg)",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 10,
                                transform: expandedSections.has(section.slug)
                                  ? "rotate(90deg)"
                                  : "none",
                                transition: "transform 0.15s",
                              }}
                            >
                              ▶
                            </span>
                            {section.name}
                            <span
                              className="badge"
                              style={{ marginLeft: "auto" }}
                            >
                              {section.articles.length}
                            </span>
                          </button>
                          {expandedSections.has(section.slug) && (
                            <div style={{ paddingLeft: 24 }}>
                              {section.articles.map(
                                (article: TocArticle) => (
                                  <Link
                                    key={article.slug}
                                    href={`/editor/${encodeURIComponent(article.file)}`}
                                    style={{
                                      display: "block",
                                      padding: "6px 12px",
                                      fontSize: 14,
                                      borderRadius: "var(--radius)",
                                      color: "var(--fg)",
                                    }}
                                  >
                                    {article.title}
                                  </Link>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
