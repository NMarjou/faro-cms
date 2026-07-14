"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import type { Toc, TocCategory } from "@/lib/types";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { canPublish } from "@/lib/permissions";
import TechWriterBlocked from "@/components/TechWriterBlocked";

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

/** Build report from /api/site/build?report — the gaps you can't see in the
 *  output: links that go nowhere, articles with no home in the published tree. */
interface SiteReport {
  pages: number;
  assets: number;
  brokenLinks: { page: string; href: string }[];
  unfiled: string[];
}

function countArticles(cat: TocCategory): number {
  let count = 0;
  for (const sec of cat.sections) {
    count += sec.articles.length;
  }
  return count;
}

export default function PublishPage() {
  const { role, loaded } = useCurrentUser();
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
  // "Publish all" — branch-wide PR (working branch → main) for shared resources
  // (snippets/variables/glossary/images/TOC structure) and bulk releases.
  // Per-article publishing happens from the editor; this ships everything else.
  const [publishingAll, setPublishingAll] = useState(false);
  const [publishAllUrl, setPublishAllUrl] = useState<string | null>(null);
  const [publishAllMsg, setPublishAllMsg] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [site, setSite] = useState<SiteReport | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);

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

    // Load condition tags (merged for the current project)
    fetch("/api/conditions")
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

  /** Build the static site. Reports first — a broken link or an unfiled article
   *  is invisible in the output itself (a dead link renders fine and just goes
   *  nowhere), so they have to be surfaced BEFORE the site ships. */
  const handleBuildSite = async () => {
    setBuilding(true);
    setSite(null);
    setSiteError(null);
    try {
      const res = await fetch("/api/site/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeTags: [...activeTags], report: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Site build failed");
      setSite(data as SiteReport);
    } catch (err) {
      setSiteError(err instanceof Error ? err.message : "Site build failed");
    } finally {
      setBuilding(false);
    }
  };

  const handleDownloadSite = async () => {
    setBuilding(true);
    setSiteError(null);
    try {
      const res = await fetch("/api/site/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeTags: [...activeTags] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Site build failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `site-${new Date().toISOString().split("T")[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setSiteError(err instanceof Error ? err.message : "Site build failed");
    } finally {
      setBuilding(false);
    }
  };

  const handlePublishAll = async () => {
    setPublishingAll(true);
    setPublishAllMsg(null);
    setPublishAllUrl(null);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Publish all pending changes",
          description: "Branch-wide content update from the CMS editor.",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Publish failed");
      }
      setPublishAllUrl(data.prUrl);
    } catch (err) {
      setPublishAllMsg(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishingAll(false);
    }
  };

  const togglePreview = (slug: string) => {
    setExpandedPreview((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  if (loaded && role === "contributor") {
    return <TechWriterBlocked title="Publish" />;
  }

  return (
    <>
      <PageHeader title="Publish">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {result && (
            <button className="btn" onClick={handleDownload}>
              Download Bundle
            </button>
          )}
          {canPublish(role) && (
            <button
              className="btn"
              disabled={building}
              onClick={handleBuildSite}
              title="Build the static site for this project — every article as a page, with images copied out and internal links resolved. Ready to deploy to Vercel."
            >
              {building ? "Building…" : "Build site"}
            </button>
          )}
          {canPublish(role) && (
            <button
              className="btn"
              disabled={publishingAll}
              onClick={handlePublishAll}
              title="Open a PR with every pending change on the working branch — shared resources (snippets, variables, glossary, images, TOC structure) and bulk releases. Individual articles publish from the editor."
            >
              {publishingAll ? "Opening PR…" : "Publish all pending"}
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
      </PageHeader>
      <div className="main-body">
        <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14 }}>
          Select which categories to compile for publication. Articles will be compiled with all snippets and variables resolved to their final values.
        </p>

        {publishAllUrl && (
          <div style={{ background: "var(--success-light, var(--info-light))", color: "var(--success, var(--info))", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>
            Opened a publish PR for all pending changes.{" "}
            <a href={publishAllUrl} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>
              View PR
            </a>
          </div>
        )}
        {publishAllMsg && (
          <div style={{ background: "var(--danger-light)", color: "var(--danger)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>
            {publishAllMsg}
          </div>
        )}

        {siteError && (
          <div style={{ background: "var(--danger-light)", color: "var(--danger)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>
            {siteError}
          </div>
        )}

        {site && (
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: site.brokenLinks.length || site.unfiled.length ? 12 : 0 }}>
              <div style={{ fontSize: 14 }}>
                <strong>{site.pages}</strong> page{site.pages !== 1 ? "s" : ""},{" "}
                <strong>{site.assets}</strong> asset{site.assets !== 1 ? "s" : ""}
                {activeTags.size > 0 && (
                  <span style={{ color: "var(--fg-muted)" }}>
                    {" "}· audience: {[...activeTags].join(", ")}
                  </span>
                )}
              </div>
              <button className="btn btn-primary" disabled={building} onClick={handleDownloadSite}>
                {building ? "Building…" : "Download site (.zip)"}
              </button>
            </div>

            {/* A dead link renders perfectly and simply goes nowhere; an unfiled
                article just never appears. Neither is visible in the built output,
                so both are named here. */}
            {site.unfiled.length > 0 && (
              <div style={{ background: "var(--warning-light)", color: "var(--warning)", padding: "8px 12px", borderRadius: "var(--radius)", fontSize: 13, marginBottom: 8 }}>
                <strong>{site.unfiled.length} article{site.unfiled.length !== 1 ? "s" : ""} not in the TOC</strong> — not published (no place in the tree):{" "}
                {site.unfiled.join(", ")}
              </div>
            )}
            {site.brokenLinks.length > 0 && (
              <div style={{ background: "var(--danger-light)", color: "var(--danger)", padding: "8px 12px", borderRadius: "var(--radius)", fontSize: 13 }}>
                <strong>{site.brokenLinks.length} broken link{site.brokenLinks.length !== 1 ? "s" : ""}</strong> — kept as-is, they lead nowhere:
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {site.brokenLinks.slice(0, 8).map((b, i) => (
                    <li key={i}>
                      <code>{b.href}</code> in {b.page}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

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
