"use client";

import { useState, useRef, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import type { Variables, GlossaryTerm as GlossaryTermType, ContentStyle } from "@/lib/types";
import ImageUpload from "./ImageUpload";
import LinkPicker from "./LinkPicker";
import Icon from "../Icon";

interface SpellIssue {
  word: string;
  suggestions: string[];
  count: number;
}

interface ToolbarProps {
  editor: Editor | null;
  variables?: Variables;
  conditionTags?: string[];
  conditionColors?: Record<string, string>;
  snippetNames?: string[];
  glossaryTerms?: GlossaryTermType[];
  styles?: ContentStyle[];
  onToggleFindReplace?: () => void;
  showWhitespace?: boolean;
  onToggleWhitespace?: () => void;
  showStructure?: boolean;
  onToggleStructure?: () => void;
  showTagBars?: boolean;
  onToggleTagBars?: () => void;
  showComments?: boolean;
  onToggleComments?: () => void;
  onAddComment?: () => void;
  commentCount?: number;
  // View mode
  viewMode?: "visual" | "source";
  onViewModeChange?: (mode: "visual" | "source") => void;
  // Spell check
  spellChecking?: boolean;
  spellIssues?: SpellIssue[];
  showSpellCheck?: boolean;
  onSpellCheck?: () => void;
  onSpellReplace?: (original: string, replacement: string) => void;
  onSpellAddToDict?: (word: string) => void;
  onSpellClose?: () => void;
  spellWordCount?: number;
  spellAddedCount?: number;
}

// Editor ribbon icons — Phosphor names per the Faro Design System mapping.
const ICONS = {
  bold:          <Icon name="text-b" size={15} title="Bold" />,
  italic:        <Icon name="text-italic" size={15} title="Italic" />,
  underline:     <Icon name="text-underline" size={15} title="Underline" />,
  strikethrough: <Icon name="text-strikethrough" size={15} title="Strikethrough" />,
  code:          <Icon name="code" size={15} title="Code" />,
  quote:         <Icon name="quotes" size={15} title="Quote" />,
  codeBlock:     <Icon name="file-code" size={15} title="Code block" />,
  hr:            <Icon name="minus" size={15} title="Horizontal rule" />,
  table:         <Icon name="table" size={15} title="Table" />,
  image:         <Icon name="image-square" size={15} title="Image" />,
  link:          <Icon name="link-simple" size={15} title="Link" />,
  video:         <Icon name="video" size={15} title="Video" />,
  box:           <Icon name="info" size={15} title="Message box" />,
  find:          <Icon name="magnifying-glass" size={15} title="Find" />,
  undo:          <Icon name="arrow-counter-clockwise" size={15} title="Undo" />,
  redo:          <Icon name="arrow-clockwise" size={15} title="Redo" />,
  conditional:   <Icon name="sliders" size={15} title="Conditional" />,
  indent:        <Icon name="text-indent" size={15} title="Indent" />,
  outdent:       <Icon name="text-outdent" size={15} title="Outdent" />,
};

function ConditionDropdown({
  editor,
  tags,
  colors = {},
}: {
  editor: Editor;
  tags: string[];
  colors?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        className="ribbon-select"
        style={{ cursor: "pointer", textAlign: "left" }}
        onMouseDown={(e) => {
          e.preventDefault(); // keep editor focus
          setOpen((p) => !p);
        }}
      >
        Condition ▾
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 100,
            background: "var(--bg, #fff)",
            border: "1px solid var(--border, #ccc)",
            borderRadius: 4,
            boxShadow: "0 2px 8px rgba(0,0,0,.15)",
            minWidth: 140,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {tags.map((t) => {
            const c = colors[t];
            return (
              <div
                key={t}
                className="ribbon-dropdown-item"
                style={{
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep editor focus
                }}
                onClick={() => {
                  const { from, to } = editor.state.selection;
                  const attrs: { tags: string[]; color?: string } = { tags: [t] };
                  if (c) attrs.color = c;
                  if (from !== to) {
                    editor.chain().focus().setConditionalMark(attrs).run();
                  } else {
                    editor.chain().focus().setConditional(attrs).run();
                  }
                  setOpen(false);
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: c || "#f59e0b",
                    flexShrink: 0,
                  }}
                />
                {t}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Toolbar({
  editor,
  variables = {},
  conditionTags = [],
  conditionColors = {},
  snippetNames = [],
  glossaryTerms = [],
  styles = [],
  onToggleFindReplace,
  showWhitespace = false,
  onToggleWhitespace,
  showStructure = false,
  onToggleStructure,
  showTagBars = true,
  onToggleTagBars,
  showComments = false,
  onToggleComments,
  onAddComment,
  commentCount = 0,
  viewMode,
  onViewModeChange,
  spellChecking = false,
  spellIssues = [],
  showSpellCheck = false,
  onSpellCheck,
  onSpellReplace,
  onSpellAddToDict,
  onSpellClose,
  spellWordCount = 0,
  spellAddedCount = 0,
}: ToolbarProps) {
  const [showImageUpload, setShowImageUpload] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);

  if (!editor) return null;

  const selectedText = (() => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to);
  })();

  const btn = (
    iconOrLabel: React.ReactNode,
    action: () => void,
    active = false,
    disabled = false,
    title?: string
  ) => (
    <button
      onClick={action}
      disabled={disabled}
      title={title}
      className={`ribbon-btn${active ? " active" : ""}`}
      style={{ opacity: disabled ? 0.35 : 1 }}
    >
      {iconOrLabel}
    </button>
  );

  const dropdown = (
    placeholder: string,
    options: { value: string; label: string }[],
    onSelect: (value: string) => void
  ) => (
    <select
      className="ribbon-select"
      onChange={(e) => {
        if (e.target.value) { onSelect(e.target.value); e.target.value = ""; }
      }}
      defaultValue=""
    >
      <option value="" disabled>{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );

  const currentHeading = [1, 2, 3, 4, 5, 6].find((l) => editor.isActive("heading", { level: l }));

  return (
    <>
      <div className="ribbon">
        {/* ═══ FORMAT ═══ */}
        <div className="ribbon-section">
          <div className="ribbon-section-label">Format</div>
          <div className="ribbon-row">
            <div className="ribbon-group">
              {btn(ICONS.bold, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"), false, "Bold")}
              {btn(ICONS.italic, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"), false, "Italic")}
              {btn(ICONS.underline, () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"), false, "Underline")}
              {btn(ICONS.strikethrough, () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"), false, "Strikethrough")}
              {btn(ICONS.code, () => editor.chain().focus().toggleCode().run(), editor.isActive("code"), false, "Inline code")}
            </div>
            <div className="ribbon-group">
              {btn(ICONS.quote, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"), false, "Block quote")}
              {btn(ICONS.codeBlock, () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock"), false, "Code block")}
              {btn(ICONS.hr, () => editor.chain().focus().setHorizontalRule().run(), false, false, "Horizontal rule")}
            </div>
            <div className="ribbon-group">
              {btn(ICONS.find, () => onToggleFindReplace?.(), false, false, "Find & Replace")}
              {btn(ICONS.undo, () => editor.chain().focus().undo().run(), false, !editor.can().undo(), "Undo")}
              {btn(ICONS.redo, () => editor.chain().focus().redo().run(), false, !editor.can().redo(), "Redo")}
            </div>
          </div>
          <div className="ribbon-row">
            <div className="ribbon-group">
              <select
                className="ribbon-select"
                value={currentHeading ? `h${currentHeading}` : "p"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "p") editor.chain().focus().setParagraph().run();
                  else editor.chain().focus().toggleHeading({ level: parseInt(v.replace("h", "")) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
                }}
              >
                <option value="p">Paragraph</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
                <option value="h4">Heading 4</option>
                <option value="h5">Heading 5</option>
                <option value="h6">Heading 6</option>
              </select>
              <select
                className="ribbon-select"
                value={editor.isActive("bulletList") ? "bullet" : editor.isActive("orderedList") ? "ordered" : "none"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "bullet") editor.chain().focus().toggleBulletList().run();
                  else if (v === "ordered") editor.chain().focus().toggleOrderedList().run();
                  else {
                    if (editor.isActive("bulletList")) editor.chain().focus().toggleBulletList().run();
                    if (editor.isActive("orderedList")) editor.chain().focus().toggleOrderedList().run();
                  }
                }}
              >
                <option value="none">No list</option>
                <option value="bullet">Bullet list</option>
                <option value="ordered">Numbered list</option>
              </select>
              {btn(ICONS.indent, () => editor.chain().focus().sinkListItem("listItem").run(), false, !editor.isActive("listItem"), "Indent (Tab)")}
              {btn(ICONS.outdent, () => editor.chain().focus().liftListItem("listItem").run(), false, !editor.isActive("listItem"), "Outdent (Shift+Tab)")}
            </div>
          </div>
        </div>

        {/* ═══ INSERT ═══ */}
        <div className="ribbon-section">
          <div className="ribbon-section-label">Insert</div>
          <div className="ribbon-row">
            <div className="ribbon-group">
              {btn(ICONS.table, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), false, false, "Insert table")}
              {btn(ICONS.image, () => setShowImageUpload(true), false, false, "Insert image")}
              {btn(ICONS.link, () => setShowLinkPicker(true), editor.isActive("link"), false, "Insert link")}
              {btn(ICONS.video, () => {
                const url = prompt("YouTube or Vimeo URL:");
                if (url) editor.chain().focus().insertVideo({ src: url }).run();
              }, false, false, "Embed video")}
            </div>
            <div className="ribbon-group">
              {dropdown("Message", [
                { value: "info", label: "Info" },
                { value: "tip", label: "Tip" },
                { value: "warning", label: "Warning" },
                { value: "danger", label: "Danger" },
                { value: "note", label: "Note" },
              ], (v) => editor.chain().focus().setMessageBox({ type: v }).run())}
              {btn(ICONS.box, () => editor.chain().focus().setStyledBlock({ className: "box" }).run(), false, false, "Insert box")}
            </div>
            <div className="ribbon-group">
              {conditionTags.length > 0 && (
                <ConditionDropdown editor={editor} tags={conditionTags} colors={conditionColors} />
              )}
            </div>
          </div>
          <div className="ribbon-row">
            <div className="ribbon-group">
              {Object.keys(variables).length > 0 && dropdown(
                "Variable",
                Object.entries(variables).map(([k, v]) => ({ value: k, label: `${k} (${v})` })),
                (v) => editor.chain().focus().insertVariable({ name: v }).run()
              )}
              {styles.length > 0 && dropdown(
                "Style",
                styles.map((s) => ({ value: s.class, label: s.name })),
                (v) => {
                  const style = styles.find((s) => s.class === v);
                  if (style?.element === "span") {
                    editor.chain().focus().setStyledMark({ className: v }).run();
                  } else {
                    editor.chain().focus().setStyledBlock({ className: v }).run();
                  }
                }
              )}
              {snippetNames.length > 0 && dropdown(
                "Snippet",
                snippetNames.map((n) => ({ value: n, label: n })),
                (v) => editor.chain().focus().insertSnippet({ name: v }).run()
              )}
              {glossaryTerms.length > 0 && dropdown(
                "Glossary",
                glossaryTerms.map((t) => ({ value: t.term, label: t.term })),
                (v) => {
                  const term = glossaryTerms.find((t) => t.term === v);
                  if (term) editor.chain().focus().insertGlossaryTerm({ term: term.term, definition: term.definition }).run();
                }
              )}
            </div>
          </div>
        </div>

        {/* ═══ TOOLS ═══ */}
        <div className="ribbon-section">
          <div className="ribbon-section-label">Tools</div>
          <div className="ribbon-row">
            <div className="ribbon-group">
              {btn(
                <Icon name="tree-structure" size={15} title="Structure" />,
                () => onToggleStructure?.(),
                showStructure,
                false,
                "HTML structure"
              )}
              {btn(
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: -0.5 }}>&#x258C;</span>,
                () => onToggleTagBars?.(),
                showTagBars,
                false,
                "Block tag bars"
              )}
            </div>
            <div className="ribbon-group">
              <button
                onClick={() => {
                  const { from, to } = editor.state.selection;
                  if (from !== to) {
                    onAddComment?.();
                  } else {
                    onToggleComments?.();
                  }
                }}
                title={(() => {
                  const { from, to } = editor.state.selection;
                  return from !== to ? "Comment on selection" : "Toggle comments drawer";
                })()}
                className={`ribbon-btn${showComments ? " active" : ""}`}
                style={{ position: "relative" }}
              >
                <Icon name="chat-circle" size={15} title="Comments" />
                {commentCount > 0 && (
                  <span style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    background: "var(--accent)",
                    color: "var(--paper-50)",
                    fontSize: 9,
                    fontFamily: "var(--font-sans)",
                    fontWeight: 700,
                    borderRadius: 99,
                    minWidth: 14,
                    height: 14,
                    lineHeight: "14px",
                    textAlign: "center",
                    padding: "0 3px",
                  }}>
                    {commentCount}
                  </span>
                )}
              </button>
            </div>
            <div className="ribbon-group">
              <button
                onClick={() => onSpellCheck?.()}
                disabled={spellChecking}
                title="Spell check"
                className={`ribbon-btn${showSpellCheck && spellIssues.length > 0 ? " active" : ""}`}
                style={{ fontWeight: 700, fontSize: 13, fontFamily: "serif", position: "relative" }}
              >
                Aa
                {showSpellCheck && spellIssues.length > 0 && (
                  <span style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    background: "var(--warning)",
                    color: "#fff",
                    fontSize: 9,
                    fontFamily: "var(--font-sans)",
                    fontWeight: 600,
                    borderRadius: 99,
                    minWidth: 14,
                    height: 14,
                    lineHeight: "14px",
                    textAlign: "center",
                    padding: "0 3px",
                  }}>
                    {spellIssues.length}
                  </span>
                )}
              </button>
            </div>
          </div>
          {viewMode && onViewModeChange && (
            <div className="ribbon-row">
              <div className="ribbon-group">
                {btn(
                  <Icon name="code-simple" size={15} title="Source" />,
                  () => onViewModeChange(viewMode === "visual" ? "source" : "visual"),
                  viewMode === "source",
                  false,
                  viewMode === "visual" ? "Switch to source" : "Switch to visual"
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ SPELL CHECK PANEL ═══ */}
      {showSpellCheck && (
        <div style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-muted)",
          fontSize: 13,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: spellIssues.length > 0 ? 8 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 12 }}>Spell Check</span>
              {!spellChecking && spellIssues.length === 0 && spellWordCount > 0 && (
                <span style={{ fontSize: 11, color: "var(--success)" }}>No issues ({spellWordCount} words)</span>
              )}
              {!spellChecking && spellIssues.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--warning)", fontWeight: 600 }}>
                  {spellIssues.length} issue{spellIssues.length !== 1 ? "s" : ""}
                </span>
              )}
              {spellChecking && <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>Checking...</span>}
              {spellAddedCount > 0 && (
                <span style={{ fontSize: 11, color: "var(--success)" }}>+{spellAddedCount} added</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button
                onClick={() => onSpellCheck?.()}
                disabled={spellChecking}
                style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", padding: "1px 8px", fontSize: 11, color: "var(--fg)" }}
              >
                Re-check
              </button>
              <button
                onClick={() => onSpellClose?.()}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--fg-muted)", lineHeight: 1, padding: "0 4px" }}
              >
                &times;
              </button>
            </div>
          </div>
          {spellIssues.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 160, overflowY: "auto" }}>
              {spellIssues.map((issue) => (
                <div
                  key={issue.word}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 6px",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                    background: "var(--bg)",
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--danger)", fontFamily: "var(--font-mono)" }}>
                    {issue.word}
                  </span>
                  {issue.count > 1 && (
                    <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>×{issue.count}</span>
                  )}
                  {issue.suggestions.length > 0 && issue.suggestions.slice(0, 3).map((sug) => (
                    <button
                      key={sug}
                      onClick={() => onSpellReplace?.(issue.word, sug)}
                      title={`Replace "${issue.word}" → "${sug}"`}
                      style={{
                        background: "none",
                        border: "1px solid var(--accent)",
                        borderRadius: "var(--radius)",
                        cursor: "pointer",
                        padding: "0 4px",
                        fontSize: 11,
                        color: "var(--accent)",
                        lineHeight: "18px",
                      }}
                    >
                      {sug}
                    </button>
                  ))}
                  <button
                    onClick={() => onSpellAddToDict?.(issue.word)}
                    title={`Add "${issue.word}" to dictionary`}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "0 2px",
                      fontSize: 13,
                      color: "var(--fg-muted)",
                      lineHeight: 1,
                    }}
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showImageUpload && (
        <ImageUpload
          onInsert={(src, alt) => { editor.chain().focus().setImage({ src, alt }).run(); setShowImageUpload(false); }}
          onClose={() => setShowImageUpload(false)}
        />
      )}
      {showLinkPicker && (
        <LinkPicker
          selectedText={selectedText}
          onInsert={(href, text) => {
            if (text && !selectedText) editor.chain().focus().insertContent(`<a href="${href}">${text}</a>`).run();
            else editor.chain().focus().setLink({ href }).run();
            setShowLinkPicker(false);
          }}
          onClose={() => setShowLinkPicker(false)}
        />
      )}
    </>
  );
}
