"use client";

import type { Editor } from "@tiptap/react";

interface TableToolbarProps {
  editor: Editor;
}

export default function TableToolbar({ editor }: TableToolbarProps) {
  if (!editor.isActive("table")) return null;

  const btn = (label: string, action: () => void) => (
    <button
      onClick={action}
      style={{
        padding: "3px 8px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        background: "var(--bg)",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        padding: "6px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--info-light)",
        fontSize: 12,
      }}
    >
      <span style={{ fontWeight: 600, color: "var(--fg-muted)", marginRight: 4, alignSelf: "center" }}>
        Table:
      </span>
      {btn("+ Row above", () => editor.chain().focus().addRowBefore().run())}
      {btn("+ Row below", () => editor.chain().focus().addRowAfter().run())}
      {btn("+ Col left", () => editor.chain().focus().addColumnBefore().run())}
      {btn("+ Col right", () => editor.chain().focus().addColumnAfter().run())}
      {btn("Delete row", () => editor.chain().focus().deleteRow().run())}
      {btn("Delete col", () => editor.chain().focus().deleteColumn().run())}
      {btn("Toggle header", () => editor.chain().focus().toggleHeaderRow().run())}
      {btn("Delete table", () => editor.chain().focus().deleteTable().run())}
    </div>
  );
}
