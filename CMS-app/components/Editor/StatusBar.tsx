"use client";

import type { Editor } from "@tiptap/react";

interface StatusBarProps {
  editor: Editor | null;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

export default function StatusBar({ editor, zoom, onZoomChange }: StatusBarProps) {
  const text = editor?.getText() || "";
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const charCount = text.length;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "6px 12px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        fontSize: 12,
        color: "var(--fg-muted)",
        flexShrink: 0,
      }}
    >
      <span>{wordCount} words</span>
      <span>{charCount} chars</span>
      <span style={{ opacity: 0.6 }}>
        {typeof navigator !== "undefined" && navigator.platform?.includes("Mac") ? "⌘" : "Ctrl+"}S Save
        {" · "}
        {typeof navigator !== "undefined" && navigator.platform?.includes("Mac") ? "⌘" : "Ctrl+"}F Find
        {" · "}
        {typeof navigator !== "undefined" && navigator.platform?.includes("Mac") ? "⌘" : "Ctrl+"}Z Undo
      </span>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={() => onZoomChange(Math.max(80, zoom - 10))}
          style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "2px 6px", fontSize: 12, background: "var(--bg)", cursor: "pointer" }}
        >−</button>
        <span style={{ minWidth: 36, textAlign: "center" }}>{zoom}%</span>
        <button
          onClick={() => onZoomChange(Math.min(150, zoom + 10))}
          style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "2px 6px", fontSize: 12, background: "var(--bg)", cursor: "pointer" }}
        >+</button>
      </div>
    </div>
  );
}
