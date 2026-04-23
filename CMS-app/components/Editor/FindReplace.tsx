"use client";

import { useState, useCallback, useEffect } from "react";
import type { Editor } from "@tiptap/react";

interface FindReplaceProps {
  editor: Editor;
  onClose: () => void;
}

export default function FindReplace({ editor, onClose }: FindReplaceProps) {
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [results, setResults] = useState<{ count: number; current: number }>({
    count: 0,
    current: 0,
  });

  const findMatches = useCallback(() => {
    if (!search) {
      setResults({ count: 0, current: 0 });
      return [];
    }
    const text = editor.getText();
    const flags = matchCase ? "g" : "gi";
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    const matches: number[] = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      matches.push(m.index);
    }
    setResults({ count: matches.length, current: matches.length > 0 ? 1 : 0 });
    return matches;
  }, [editor, search, matchCase]);

  useEffect(() => {
    findMatches();
  }, [findMatches]);

  const handleReplace = () => {
    if (!search) return;
    const { state } = editor;
    const { from, to } = state.selection;
    const selectedText = state.doc.textBetween(from, to);
    const isMatch = matchCase
      ? selectedText === search
      : selectedText.toLowerCase() === search.toLowerCase();
    if (isMatch) {
      editor.chain().focus().insertContentAt({ from, to }, replace).run();
    }
  };

  const handleReplaceAll = () => {
    if (!search) return;
    const text = editor.getText();
    const flags = matchCase ? "g" : "gi";
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    // Get full HTML, do replacement, set content
    let html = editor.getHTML();
    html = html.replace(regex, replace);
    editor.commands.setContent(html);
    setResults({ count: 0, current: 0 });
  };

  return (
    <div className="find-replace-panel">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find..."
          autoFocus
          style={{ flex: 1, padding: "4px 8px", fontSize: 13 }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
        />
        <input
          className="input"
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          placeholder="Replace..."
          style={{ flex: 1, padding: "4px 8px", fontSize: 13 }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
        />
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(e) => setMatchCase(e.target.checked)}
          />
          Aa
        </label>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
        <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>
          {results.count > 0
            ? `${results.current} of ${results.count}`
            : search
              ? "No results"
              : ""}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={handleReplace} className="btn btn-sm" disabled={!search}>
          Replace
        </button>
        <button onClick={handleReplaceAll} className="btn btn-sm" disabled={!search}>
          Replace All
        </button>
        <button onClick={onClose} className="btn btn-sm">
          Close
        </button>
      </div>
    </div>
  );
}
