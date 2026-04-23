"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { QAIssue } from "@/lib/types";

interface QAResult {
  issues: QAIssue[];
  summary: { total: number; errors: number; warnings: number; info: number };
}

/** Parse a spelling detail string into individual words */
function parseSpellingWords(detail: string): { word: string; count: number; suggestions: string[] }[] {
  if (!detail) return [];
  const results: { word: string; count: number; suggestions: string[] }[] = [];
  // Format: "word" (×N) → sug1, sug2; "word2" → sug; +N more
  const parts = detail.split(";").map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith("+")) continue; // "+N more" overflow indicator
    const wordMatch = part.match(/^"([^"]+)"/);
    if (!wordMatch) continue;
    const word = wordMatch[1];
    const countMatch = part.match(/\(×(\d+)\)/);
    const count = countMatch ? parseInt(countMatch[1]) : 1;
    const sugMatch = part.match(/→\s*(.+)$/);
    const suggestions = sugMatch ? sugMatch[1].split(",").map((s) => s.trim()) : [];
    results.push({ word, count, suggestions });
  }
  return results;
}

export default function QAPage() {
  const [data, setData] = useState<QAResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());
  const [addingWord, setAddingWord] = useState<string | null>(null);

  const runScan = () => {
    setLoading(true);
    fetch("/api/qa")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { runScan(); }, []);

  const handleAddToDictionary = async (word: string) => {
    setAddingWord(word);
    try {
      const res = await fetch("/api/qa/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words: [word] }),
      });
      if (res.ok) {
        setAddedWords((prev) => new Set([...prev, word.toLowerCase()]));
      }
    } catch { /* ignore */ }
    setAddingWord(null);
  };

  const handleAddAllToDictionary = async (words: string[]) => {
    const toAdd = words.filter((w) => !addedWords.has(w.toLowerCase()));
    if (toAdd.length === 0) return;
    setAddingWord("__all__");
    try {
      const res = await fetch("/api/qa/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words: toAdd }),
      });
      if (res.ok) {
        setAddedWords((prev) => new Set([...prev, ...toAdd.map((w) => w.toLowerCase())]));
      }
    } catch { /* ignore */ }
    setAddingWord(null);
  };

  const filtered = data?.issues.filter((i) =>
    filter === "all" ? true : i.type === filter
  ) || [];

  const severityColor = (s: string) =>
    s === "error" ? "var(--danger)" : s === "warning" ? "var(--warning)" : "var(--info)";

  const typeLabels: Record<string, string> = {
    "broken-link": "Broken Link",
    "stale-article": "Stale Article",
    "orphan-article": "Orphan Article",
    "missing-image": "Missing Image",
    "empty-article": "Empty Article",
    "spelling": "Spelling",
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case "spelling": return "Aa";
      default: return null;
    }
  };

  const spellingCount = data?.issues.filter((i) => i.type === "spelling").length || 0;

  return (
    <>
      <header className="main-header">
        <h1>QA Dashboard</h1>
        <button onClick={runScan} className="btn btn-primary" disabled={loading}>
          {loading ? "Scanning..." : "Re-scan"}
        </button>
      </header>
      <div className="main-body">
        {loading && <p>Scanning content for issues...</p>}

        {data && (
          <>
            <div className="dashboard-stats" style={{ marginBottom: 24 }}>
              <div className="stat-card">
                <div className="stat-value" style={{ color: data.summary.errors > 0 ? "var(--danger)" : "var(--success)" }}>{data.summary.errors}</div>
                <div className="stat-label">Errors</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: data.summary.warnings > 0 ? "var(--warning)" : "var(--success)" }}>{data.summary.warnings}</div>
                <div className="stat-label">Warnings</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: "var(--info)" }}>{data.summary.info}</div>
                <div className="stat-label">Info</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
              {["all", "broken-link", "missing-image", "empty-article", "spelling", "stale-article"].map((f) => {
                const count = f === "all" ? data.issues.length : data.issues.filter((i) => i.type === f).length;
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`btn btn-sm${filter === f ? " btn-primary" : ""}`}
                  >
                    {f === "all" ? "All" : typeLabels[f] || f}
                    {count > 0 && <span style={{ marginLeft: 4, opacity: 0.7 }}>({count})</span>}
                  </button>
                );
              })}
              {addedWords.size > 0 && (
                <span style={{ fontSize: 12, color: "var(--success)", marginLeft: 8 }}>
                  {addedWords.size} word{addedWords.size !== 1 ? "s" : ""} added to dictionary — re-scan to update
                </span>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="empty-state">
                <h3>{filter === "all" ? "No issues found" : `No ${typeLabels[filter] || filter} issues`}</h3>
                <p>Your content is in good shape.</p>
              </div>
            ) : (
              <div>
                {filtered.map((issue, i) => {
                  const isSpelling = issue.type === "spelling";
                  const spellingWords = isSpelling ? parseSpellingWords(issue.detail || "") : [];

                  return (
                    <div
                      key={i}
                      style={{
                        padding: "12px 16px",
                        border: "1px solid var(--border)",
                        borderLeft: `4px solid ${severityColor(issue.severity)}`,
                        borderRadius: "var(--radius)",
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {typeIcon(issue.type) && (
                            <span style={{ fontSize: 14, fontWeight: 700, color: severityColor(issue.severity), fontFamily: "var(--font-mono)", width: 24, textAlign: "center" }}>
                              {typeIcon(issue.type)}
                            </span>
                          )}
                          <div>
                            <span className="badge" style={{ background: `${severityColor(issue.severity)}20`, color: severityColor(issue.severity), marginRight: 8 }}>
                              {typeLabels[issue.type] || issue.type}
                            </span>
                            <span style={{ fontSize: 14 }}>{issue.message}</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {isSpelling && spellingWords.length > 0 && (
                            <button
                              className="btn btn-sm"
                              onClick={() => handleAddAllToDictionary(spellingWords.map((w) => w.word))}
                              disabled={addingWord === "__all__" || spellingWords.every((w) => addedWords.has(w.word.toLowerCase()))}
                              title="Add all words to custom dictionary"
                              style={{ fontSize: 11 }}
                            >
                              Add all to dictionary
                            </button>
                          )}
                          <Link
                            href={`/editor/${encodeURIComponent(issue.file)}`}
                            className="btn btn-sm"
                          >
                            Edit
                          </Link>
                        </div>
                      </div>

                      {/* Spelling: show individual words with actions */}
                      {isSpelling && spellingWords.length > 0 ? (
                        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {spellingWords.map((entry) => {
                            const isAdded = addedWords.has(entry.word.toLowerCase());
                            return (
                              <div
                                key={entry.word}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "3px 8px",
                                  borderRadius: "var(--radius)",
                                  border: "1px solid var(--border)",
                                  fontSize: 12,
                                  background: isAdded ? "rgba(16, 185, 129, 0.08)" : "var(--bg)",
                                  opacity: isAdded ? 0.5 : 1,
                                }}
                              >
                                <span style={{ fontWeight: 600, color: isAdded ? "var(--success)" : "var(--danger)", fontFamily: "var(--font-mono)", textDecoration: isAdded ? "line-through" : "none" }}>
                                  {entry.word}
                                </span>
                                {entry.count > 1 && (
                                  <span style={{ color: "var(--fg-muted)", fontSize: 11 }}>×{entry.count}</span>
                                )}
                                {entry.suggestions.length > 0 && !isAdded && (
                                  <span style={{ color: "var(--fg-muted)", fontSize: 11 }}>
                                    → {entry.suggestions.join(", ")}
                                  </span>
                                )}
                                {!isAdded && (
                                  <button
                                    onClick={() => handleAddToDictionary(entry.word)}
                                    disabled={addingWord === entry.word}
                                    title={`Add "${entry.word}" to custom dictionary`}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      cursor: "pointer",
                                      padding: "0 2px",
                                      fontSize: 14,
                                      color: "var(--accent)",
                                      lineHeight: 1,
                                    }}
                                  >
                                    +
                                  </button>
                                )}
                                {isAdded && (
                                  <span style={{ fontSize: 11, color: "var(--success)" }}>✓</span>
                                )}
                              </div>
                            );
                          })}
                          {issue.detail?.includes("+") && (
                            <span style={{ fontSize: 11, color: "var(--fg-muted)", alignSelf: "center" }}>
                              {issue.detail.match(/\+\d+ more/)?.[0]}
                            </span>
                          )}
                        </div>
                      ) : (
                        issue.detail && (
                          <p style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
                            {issue.detail}
                          </p>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
