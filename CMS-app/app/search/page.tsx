"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { SearchEntry } from "@/lib/types";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(SearchEntry & { score?: number })[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    setSearched(true);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <>
      <header className="main-header">
        <h1>Search</h1>
      </header>
      <div className="main-body">
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch(query)}
            placeholder="Search articles..."
            style={{ maxWidth: 480 }}
          />
          <button
            onClick={() => doSearch(query)}
            className="btn btn-primary"
            disabled={loading || query.length < 2}
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        {results.length > 0 && (
          <div>
            <p
              style={{
                fontSize: 14,
                color: "var(--fg-muted)",
                marginBottom: 12,
              }}
            >
              {results.length} results
            </p>
            {results.map((result) => (
              <Link
                key={result.slug}
                href={`/editor/${encodeURIComponent(result.filePath)}`}
                style={{
                  display: "block",
                  padding: "12px 16px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  marginBottom: 8,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <h3 style={{ fontSize: 15, marginBottom: 4 }}>
                  {result.title}
                </h3>
                <div style={{ display: "flex", gap: 8 }}>
                  <span className="badge badge-accent">{result.category}</span>
                  <span className="badge">{result.section}</span>
                </div>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--fg-muted)",
                    marginTop: 6,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {result.bodyText.slice(0, 200)}
                </p>
              </Link>
            ))}
          </div>
        )}

        {searched && results.length === 0 && !loading && (
          <div className="empty-state">
            <h3>No results found</h3>
            <p>Try a different search term.</p>
          </div>
        )}
      </div>
    </>
  );
}
