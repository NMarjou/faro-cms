"use client";

import { useEffect, useState } from "react";

interface UnresolvedLink {
  sourceFile: string;
  sourceTitle: string;
  linkText: string;
  originalHref: string;
  suggestedSlug: string | null;
  suggestedTitle: string | null;
  lineSnippet: string;
}

interface ArticleOption {
  slug: string;
  title: string;
  file: string;
}

interface ScanResult {
  unresolvedLinks: UnresolvedLink[];
  articles: ArticleOption[];
  stats: {
    totalArticlesScanned: number;
    totalUnresolvedLinks: number;
    autoMatchedLinks: number;
  };
}

export default function LinkMapperPage() {
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Mapping state: key = "sourceFile::originalHref", value = target slug
  const [mappings, setMappings] = useState<Record<string, string>>({});
  // Track which links are skipped
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // Filter
  const [filter, setFilter] = useState<"all" | "matched" | "unmatched">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    setSuccess(null);
    setResult(null);
    setMappings({});
    setSkipped(new Set());
    try {
      const res = await fetch("/api/link-mapper");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Scan failed");
      }
      const data: ScanResult = await res.json();
      setResult(data);

      // Pre-populate mappings with auto-suggestions
      const initial: Record<string, string> = {};
      for (const link of data.unresolvedLinks) {
        if (link.suggestedSlug) {
          initial[linkKey(link)] = link.suggestedSlug;
        }
      }
      setMappings(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const linkKey = (link: UnresolvedLink) => `${link.sourceFile}::${link.originalHref}`;

  const setMapping = (link: UnresolvedLink, slug: string) => {
    const key = linkKey(link);
    setMappings((prev) => {
      if (!slug) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: slug };
    });
    // Remove from skipped if mapping is set
    setSkipped((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const toggleSkip = (link: UnresolvedLink) => {
    const key = linkKey(link);
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        // Remove mapping if skipping
        setMappings((prev) => {
          const n = { ...prev };
          delete n[key];
          return n;
        });
      }
      return next;
    });
  };

  const acceptAllSuggestions = () => {
    if (!result) return;
    const initial: Record<string, string> = {};
    for (const link of result.unresolvedLinks) {
      if (link.suggestedSlug) {
        initial[linkKey(link)] = link.suggestedSlug;
      }
    }
    setMappings(initial);
  };

  const handleApply = async () => {
    const toApply = Object.entries(mappings)
      .filter(([key]) => !skipped.has(key))
      .map(([key, targetSlug]) => {
        const [sourceFile, originalHref] = key.split("::");
        return { sourceFile, originalHref, targetSlug };
      });

    if (toApply.length === 0) {
      setError("No mappings to apply. Map at least one link or accept suggestions.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/link-mapper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings: toApply }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Apply failed");
      }
      const data = await res.json();
      setSuccess(`Updated ${data.filesUpdated} file${data.filesUpdated !== 1 ? "s" : ""}, rewrote ${data.linksRewritten} link${data.linksRewritten !== 1 ? "s" : ""}.`);
      // Re-scan to refresh
      handleScan();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setSaving(false);
    }
  };

  // Filter links
  const filteredLinks = result?.unresolvedLinks.filter((link) => {
    const key = linkKey(link);
    if (filter === "matched" && !mappings[key]) return false;
    if (filter === "unmatched" && (mappings[key] || skipped.has(key))) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        link.sourceTitle.toLowerCase().includes(q) ||
        link.linkText.toLowerCase().includes(q) ||
        link.originalHref.toLowerCase().includes(q)
      );
    }
    return true;
  }) || [];

  // Group by source file
  const groupedByFile: Record<string, UnresolvedLink[]> = {};
  for (const link of filteredLinks) {
    if (!groupedByFile[link.sourceFile]) groupedByFile[link.sourceFile] = [];
    groupedByFile[link.sourceFile].push(link);
  }

  const mappedCount = Object.keys(mappings).filter((k) => !skipped.has(k)).length;
  const skippedCount = skipped.size;
  const totalUnresolved = result?.unresolvedLinks.length || 0;

  return (
    <>
      <header className="main-header">
        <h1>Link Mapper</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {result && mappedCount > 0 && (
            <button
              className="btn btn-primary"
              disabled={saving}
              onClick={handleApply}
            >
              {saving ? "Applying..." : `Apply ${mappedCount} mapping${mappedCount !== 1 ? "s" : ""}`}
            </button>
          )}
          <button
            className="btn"
            disabled={scanning}
            onClick={handleScan}
          >
            {scanning ? "Scanning..." : "Scan Articles"}
          </button>
        </div>
      </header>
      <div className="main-body">
        <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14 }}>
          Scan all articles for unresolved internal links (e.g. from Madcap Flare imports) and map them to CMS articles.
        </p>

        {/* Error / Success banners */}
        {error && (
          <div style={{ background: "var(--danger-light)", color: "var(--danger)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ background: "#dcfce7", color: "#166534", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>
            {success}
          </div>
        )}

        {/* No scan yet */}
        {!result && !scanning && (
          <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 16px", opacity: 0.5 }}>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>No scan results yet</p>
            <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 16 }}>
              Click &quot;Scan Articles&quot; to find unresolved internal links across all articles in the TOC.
            </p>
          </div>
        )}

        {scanning && (
          <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
            <p style={{ fontSize: 15 }}>Scanning articles for unresolved links...</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Stats bar */}
            <div className="card" style={{ marginBottom: 16, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{totalUnresolved}</div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>Unresolved links</div>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--success)" }}>{result.stats.autoMatchedLinks}</div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>Auto-matched</div>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>{mappedCount}</div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>Mapped</div>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{skippedCount}</div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>Skipped</div>
              </div>
              <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--fg-muted)" }}>
                {result.stats.totalArticlesScanned} articles scanned
              </div>
            </div>

            {totalUnresolved === 0 ? (
              <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
                <span style={{ fontSize: 36 }}>&#10003;</span>
                <p style={{ fontSize: 15, fontWeight: 500, marginTop: 8 }}>All links resolved!</p>
                <p style={{ fontSize: 13, color: "var(--fg-muted)" }}>No unresolved internal links found.</p>
              </div>
            ) : (
              <>
                {/* Toolbar */}
                <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
                  <button className={`btn btn-sm${filter === "all" ? " btn-primary" : ""}`} onClick={() => setFilter("all")}>
                    All ({totalUnresolved})
                  </button>
                  <button className={`btn btn-sm${filter === "matched" ? " btn-primary" : ""}`} onClick={() => setFilter("matched")}>
                    Mapped ({mappedCount})
                  </button>
                  <button className={`btn btn-sm${filter === "unmatched" ? " btn-primary" : ""}`} onClick={() => setFilter("unmatched")}>
                    Needs attention ({totalUnresolved - mappedCount - skippedCount})
                  </button>
                  <div style={{ flex: 1 }} />
                  <input
                    type="text"
                    placeholder="Search links..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      padding: "4px 10px",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      fontSize: 13,
                      width: 200,
                      background: "var(--bg)",
                      color: "var(--fg)",
                    }}
                  />
                  <button className="btn btn-sm" onClick={acceptAllSuggestions} title="Accept all auto-matched suggestions">
                    Accept All Suggestions
                  </button>
                </div>

                {/* Link table grouped by file */}
                {Object.entries(groupedByFile).map(([file, links]) => (
                  <div key={file} className="card" style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{links[0].sourceTitle}</span>
                      <span style={{ fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}>{file}</span>
                      <span className="badge" style={{ marginLeft: "auto" }}>{links.length}</span>
                    </div>

                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--fg-muted)", fontWeight: 500, fontSize: 11, textTransform: "uppercase" }}>Link Text</th>
                          <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--fg-muted)", fontWeight: 500, fontSize: 11, textTransform: "uppercase" }}>Original Href</th>
                          <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--fg-muted)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", minWidth: 220 }}>Map To</th>
                          <th style={{ textAlign: "center", padding: "6px 8px", width: 60 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {links.map((link, i) => {
                          const key = linkKey(link);
                          const isSkipped = skipped.has(key);
                          const currentMapping = mappings[key] || "";
                          return (
                            <tr key={i} style={{
                              borderBottom: "1px solid var(--border)",
                              opacity: isSkipped ? 0.4 : 1,
                              background: isSkipped ? "var(--bg-muted)" : currentMapping ? "rgba(16, 185, 129, 0.04)" : "transparent",
                            }}>
                              <td style={{ padding: "8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {link.linkText || <span style={{ color: "var(--fg-muted)", fontStyle: "italic" }}>no text</span>}
                              </td>
                              <td style={{ padding: "8px", fontFamily: "var(--font-mono)", fontSize: 11, maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--danger)" }}>
                                {link.originalHref}
                              </td>
                              <td style={{ padding: "8px" }}>
                                <select
                                  value={currentMapping}
                                  onChange={(e) => setMapping(link, e.target.value)}
                                  disabled={isSkipped}
                                  style={{
                                    width: "100%",
                                    padding: "4px 8px",
                                    border: `1px solid ${currentMapping ? "var(--success)" : "var(--border)"}`,
                                    borderRadius: "var(--radius)",
                                    fontSize: 12,
                                    background: "var(--bg)",
                                    color: "var(--fg)",
                                    cursor: isSkipped ? "not-allowed" : "pointer",
                                  }}
                                >
                                  <option value="">— Select target article —</option>
                                  {link.suggestedSlug && (
                                    <option value={link.suggestedSlug}>
                                      ★ {link.suggestedTitle} ({link.suggestedSlug})
                                    </option>
                                  )}
                                  {result.articles
                                    .filter((a) => a.slug !== link.suggestedSlug)
                                    .map((a) => (
                                      <option key={a.slug} value={a.slug}>
                                        {a.title} ({a.slug})
                                      </option>
                                    ))}
                                </select>
                              </td>
                              <td style={{ padding: "8px", textAlign: "center" }}>
                                <button
                                  onClick={() => toggleSkip(link)}
                                  title={isSkipped ? "Unskip" : "Skip this link"}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontSize: 16,
                                    color: isSkipped ? "var(--accent)" : "var(--fg-muted)",
                                    padding: "2px 6px",
                                  }}
                                >
                                  {isSkipped ? "↩" : "✕"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
