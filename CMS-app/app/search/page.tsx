"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import SearchResultRow from "@/components/SearchResultRow";
import type { SearchResult } from "@/lib/types";

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    setSearched(true);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
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
      <PageHeader title="Search" />
      <div className="main-body">
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch(query)}
            placeholder="Search articles, snippets, images, variables, glossary…"
            style={{ maxWidth: 480 }}
          />
          <button
            onClick={() => doSearch(query)}
            className="btn btn-primary"
            disabled={loading || query.trim().length < 2}
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        {results.length > 0 && (
          <div style={{ maxWidth: 640 }}>
            <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 12 }}>
              {results.length} result{results.length === 1 ? "" : "s"}
            </p>
            {results.map((result) => (
              <SearchResultRow
                key={result.id}
                result={result}
                onSelect={() => router.push(result.href)}
                onOpen={() => router.push(result.href)}
              />
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
