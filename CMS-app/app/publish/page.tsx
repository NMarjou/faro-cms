"use client";

import { useEffect, useState } from "react";
import type { Toc, TocCategory } from "@/lib/types";

interface CompiledArticle {
  title: string;
  slug: string;
  file: string;
  html: string;
  snippets: string[];
}

interface CompiledSection {
  name: string;
  slug: string;
  articles: CompiledArticle[];
}

interface CompiledCategory {
  name: string;
  slug: string;
  description: string;
  sections: CompiledSection[];
}

interface CompileResult {
  categories: CompiledCategory[];
  stats: { totalArticles: number; totalErrors: number; totalCategories: number };
}

function countArticles(cat: TocCategory): number {
  let count = 0;
  for (const sec of cat.sections) {
    count += sec.articles.length;
  }
  return count;
}

export default function PublishPage() {
  const [toc, setToc] = useState<Toc | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [conditionTags, setConditionTags] = useState<string[]>([]);
  const [conditionColors, setConditionColors] = useState<Record<string, string>>({});
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [compiling, setCompiling] = useState(false);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedPreview, setExpandedPreview] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Load TOC
    fetch("/api/toc")
      .then((r) => r.json())
      .then((data: Toc) => {
        setToc(data);
        setSelected(new Set(data.categories.map((c) => c.slug)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Load condition tags
    fetch("/api/content?path=conditions.json")
      .then((r) => r.json())
      .then((d) => {
        const parsed = d.content ? JSON.parse(d.content) : d;
        const tags: string[] = parsed.tags || [];
        setConditionTags(tags);
        setConditionColors(parsed.colors || {});
        // Restore saved selection from localStorage, default to all selected
        const saved = localStorage.getItem("cms-publish-conditions");
        if (saved) {
          try {
            const savedTags: string[] = JSON.parse(saved);
            setActiveTags(new Set(savedTags.filter((t) => tags.includes(t))));
          } catch { setActiveTags(new Set(tags)); }
        } else {
          setActiveTags(new Set(tags));
        }
      })
      .catch(() => {});
  }, []);

  const toggleCategory = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  const toggleCondition = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      // Persist to localStorage
      localStorage.setItem("cms-publish-conditions", JSON.stringify([...next]));
      return next;
    });
  };

  const selectAllConditions = () => {
    setActiveTags(new Set(conditionTags));
    localStorage.setItem("cms-publish-conditions", JSON.stringify(conditionTags));
  };

  const selectNoConditions = () => {
    setActiveTags(new Set());
    localStorage.setItem("cms-publish-conditions", JSON.stringify([]));
  };

  const selectAll = () => {
    if (toc) setSelected(new Set(toc.categories.map((c) => c.slug)));
  };

  const selectNone = () => setSelected(new Set());

  const totalSelected = toc
    ? toc.categories.filter((c) => selected.has(c.slug)).reduce((sum, c) => sum + countArticles(c), 0)
    : 0;

  const handleCompile = async () => {
    setCompiling(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: [...selected], activeTags: [...activeTags] }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Compilation failed");
      }
      const data: CompileResult = await res.json();
      setResult(data);
      // Auto-expand first category
      if (data.categories.length > 0) {
        setExpandedPreview(new Set([data.categories[0].slug]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compilation failed");
    } finally {
      setCompiling(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `publish-bundle-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const togglePreview = (slug: string) => {
    setExpandedPreview((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  return (
    <>
      <header className="main-header">
        <h1>Publish</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {result && (
            <button className="btn" onClick={handleDownload}>
              Download Bundle
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={compiling || selected.size === 0}
            onClick={handleCompile}
          >
            {compiling ? "Compiling..." : `Compile ${totalSelected} article${totalSelected !== 1 ? "s" : ""}`}
          </button>
        </div>
      </header>
      <div className="main-body">
        <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14 }}>
          Select which categories to compile for publication. Articles will be compiled with all snippets and variables resolved to their final values.
        </p>

        {loading && <p>Loading...</p>}

        {/* Category selection */}
        {toc && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Categories</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm" onClick={selectAll}>Select All</button>
                <button className="btn btn-sm" onClick={selectNone}>Select None</button>
              </div>
            </div>
            {toc.categories.map((cat) => {
              const articleCount = countArticles(cat);
              return (
                <label
                  key={cat.slug}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    borderTop: "1px solid var(--border)",
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                  className="recent-article-row"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(cat.slug)}
                    onChange={() => toggleCategory(cat.slug)}
                    style={{ width: 18, height: 18, cursor: "pointer" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{cat.name}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                      {cat.description || "No description"} — {articleCount} article{articleCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <span className="badge">{articleCount}</span>
                </label>
              );
            })}
          </div>
        )}

        {/* Condition tag selection */}
        {conditionTags.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Conditions</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm" onClick={selectAllConditions}>Include All</button>
                <button className="btn btn-sm" onClick={selectNoConditions}>Exclude All</button>
              </div>
            </div>
            <p style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 8 }}>
              Checked tags = content included. Unchecked = conditional content stripped from output.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {conditionTags.map((tag) => {
                const c = conditionColors[tag] || "#f59e0b";
                return (
                  <label
                    key={tag}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 12px",
                      border: `1px solid ${activeTags.has(tag) ? c : "var(--border)"}`,
                      borderLeft: `3px solid ${c}`,
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      background: activeTags.has(tag) ? hexToRgba(c, 0.08) : "var(--bg)",
                      transition: "background 0.1s, border-color 0.1s",
                      fontSize: 13,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={activeTags.has(tag)}
                      onChange={() => toggleCondition(tag)}
                      style={{ cursor: "pointer", accentColor: c }}
                    />
                    {tag}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: "var(--danger-light)", color: "var(--danger)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>
            {error}
          </div>
        )}

        {/* Compile results */}
        {result && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Compiled Output</h2>
              <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>
                {result.stats.totalArticles} articles compiled across {result.stats.totalCategories} categories
                {result.stats.totalErrors > 0 && (
                  <span style={{ color: "var(--danger)", marginLeft: 8 }}>
                    ({result.stats.totalErrors} errors)
                  </span>
                )}
              </span>
            </div>

            {result.categories.map((cat) => (
              <div key={cat.slug} className="card" style={{ marginBottom: 12 }}>
                <button
                  onClick={() => togglePreview(cat.slug)}
                  style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: 0, fontFamily: "inherit", width: "100%" }}
                >
                  <span style={{ fontSize: 12, transition: "transform 0.15s", transform: expandedPreview.has(cat.slug) ? "rotate(90deg)" : "none" }}>&#9654;</span>
                  <h3 style={{ fontSize: 15, fontWeight: 600 }}>{cat.name}</h3>
                  <span className="badge" style={{ marginLeft: 4 }}>
                    {cat.sections.reduce((sum, s) => sum + s.articles.length, 0)}
                  </span>
                </button>

                {expandedPreview.has(cat.slug) && (
                  <div style={{ marginTop: 12 }}>
                    {cat.sections.map((sec) => (
                      <div key={sec.slug} style={{ marginLeft: 16, marginBottom: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-muted)", marginBottom: 4 }}>
                          {sec.name}
                        </div>
                        {sec.articles.map((art) => (
                          <div
                            key={art.slug}
                            style={{
                              marginLeft: 16,
                              padding: "6px 0",
                              borderBottom: "1px solid var(--border)",
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              fontSize: 13,
                            }}
                          >
                            {art.html ? (
                              <span style={{ color: "var(--success)" }}>&#10003;</span>
                            ) : (
                              <span style={{ color: "var(--danger)" }}>&#10007;</span>
                            )}
                            <span>{art.title}</span>
                            {art.snippets.length > 0 && (
                              <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                                ({art.snippets.length} snippet{art.snippets.length !== 1 ? "s" : ""} resolved)
                              </span>
                            )}
                            <span style={{ fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>
                              {art.file}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(245, 158, 11, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
