"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchResult } from "@/lib/types";
import Icon from "./Icon";
import SearchResultRow from "./SearchResultRow";

/**
 * Global, non-modal cross-platform search panel. Docked to the right of the
 * screen; the rest of the app stays interactive (no backdrop). Opened with
 * Cmd/Ctrl-K or the `cms-open-search` window event (dispatched by the sidebar
 * launcher). Results span every object type (articles, snippets, images,
 * variables, glossary, conditions, styles), scoped to the current project with
 * shared objects included. Single click selects a row; double click (or Enter)
 * opens it. Placement is intentionally easy to flip to a bottom drawer later.
 */
export default function SearchPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqSeq = useRef(0);

  // Cmd/Ctrl-K toggles the panel; a custom event opens it (sidebar launcher).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpenEvent = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("cms-open-search", onOpenEvent);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("cms-open-search", onOpenEvent);
    };
  }, []);

  // Focus the input whenever the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced search. A monotonically increasing seq guards against a slow
  // earlier request landing after a newer one (out-of-order responses).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++reqSeq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (seq !== reqSeq.current) return; // a newer query superseded this one
        setResults(data.results || []);
        setSelected(0);
      } catch {
        if (seq === reqSeq.current) setResults([]);
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  const openResult = useCallback(
    (r: SearchResult) => {
      setOpen(false);
      router.push(r.href);
    },
    [router]
  );

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      openResult(results[selected]);
    }
  };

  if (!open) return null;

  const showEmpty = !loading && query.trim().length >= 2 && results.length === 0;

  return (
    <aside
      aria-label="Search"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 400,
        maxWidth: "92vw",
        background: "var(--bg)",
        borderLeft: "1px solid var(--border)",
        boxShadow: "var(--shadow-drawer)",
        zIndex: 250,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Icon
              name="magnifying-glass"
              size={15}
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--fg-muted)" }}
            />
            <input
              ref={inputRef}
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search everything…"
              style={{ width: "100%", paddingLeft: 30 }}
            />
          </div>
          <button
            onClick={() => setOpen(false)}
            title="Close (Esc)"
            aria-label="Close search"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              flexShrink: 0,
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--fg-muted)",
              cursor: "pointer",
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--fg-muted)" }}>
          <span>{loading ? "Searching…" : results.length > 0 ? `${results.length} result${results.length === 1 ? "" : "s"}` : "Names & full text · this project + shared"}</span>
          <span>Double-click to open</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {results.map((r, i) => (
          <SearchResultRow
            key={r.id}
            result={r}
            query={query}
            selected={i === selected}
            onSelect={() => setSelected(i)}
            onOpen={() => openResult(r)}
          />
        ))}
        {showEmpty && (
          <div style={{ textAlign: "center", color: "var(--fg-muted)", fontSize: 13, padding: "32px 16px" }}>
            No matches for “{query.trim()}”.
          </div>
        )}
        {!loading && query.trim().length < 2 && (
          <div style={{ textAlign: "center", color: "var(--fg-muted)", fontSize: 13, padding: "32px 16px" }}>
            Type at least 2 characters to search.
          </div>
        )}
      </div>
    </aside>
  );
}
