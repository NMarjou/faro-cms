"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent, type Editor as TipTapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import type { JSONContent } from "@tiptap/react";

import { MessageBox } from "./extensions/MessageBox";
import { VariableInline } from "./extensions/VariableInline";
import { ConditionalBlock } from "./extensions/ConditionalBlock";
import { ConditionalMark } from "./extensions/ConditionalMark";
import { SnippetBlock } from "./extensions/SnippetBlock";
import { VideoEmbed } from "./extensions/VideoEmbed";
import { GlossaryTerm } from "./extensions/GlossaryTerm";
import { StyledBlock } from "./extensions/StyledBlock";
import { StyledMark } from "./extensions/StyledMark";
import Toolbar from "./Toolbar";
import TableToolbar from "./TableToolbar";
import FindReplace from "./FindReplace";
import StatusBar from "./StatusBar";
import HtmlStructure from "./HtmlStructure";
import BlockTagBar from "./BlockTagBar";
import { WhitespaceDecoration, whitespaceKey } from "./extensions/WhitespaceDecoration";
import { ListNesting } from "./extensions/ListNesting";
import { CommentMark } from "./extensions/CommentMark";
import CommentsDrawer from "./CommentsDrawer";
import type { Comment } from "./CommentsDrawer";

import type { Variables, GlossaryTerm as GlossaryTermType, ContentStyle } from "@/lib/types";

interface SpellIssue {
  word: string;
  suggestions: string[];
  count: number;
}

interface EditorProps {
  initialContent?: JSONContent;
  initialHtml?: string;
  variables?: Variables;
  conditionTags?: string[];
  conditionColors?: Record<string, string>;
  snippetNames?: string[];
  glossaryTerms?: GlossaryTermType[];
  styles?: ContentStyle[];
  onChange?: (content: JSONContent) => void;
  onSave?: () => void;
  onEditorReady?: (editor: { getHTML: () => string; getSelectedText: () => string; commands: { setContent: (html: string) => boolean } }) => void;
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

export default function Editor({
  initialContent,
  initialHtml,
  variables = {},
  conditionTags = [],
  conditionColors = {},
  snippetNames = [],
  glossaryTerms = [],
  styles = [],
  onChange,
  onSave,
  onEditorReady,
  viewMode,
  onViewModeChange,
  spellChecking,
  spellIssues,
  showSpellCheck,
  onSpellCheck,
  onSpellReplace,
  onSpellAddToDict,
  onSpellClose,
  spellWordCount,
  spellAddedCount,
}: EditorProps) {
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const [showTagBars, setShowTagBars] = useState(true);
  const [ribbonCollapsed, setRibbonCollapsed] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [pendingHighlight, setPendingHighlight] = useState<string | null>(null);
  const editorRef = useRef<TipTapEditor | null>(null);

  // Load user preferences from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("cms-editor-zoom");
    if (saved) setZoom(Number(saved));
    const ws = localStorage.getItem("cms-show-whitespace");
    if (ws === "true") setShowWhitespace(true);

    // Apply editor font preference
    const fontMap: Record<string, string> = {
      "dm-sans": "var(--font-dm-sans), sans-serif",
      lora: "var(--font-lora), serif",
      cormorant: "var(--font-cormorant), serif",
    };
    const font = localStorage.getItem("cms-editor-font");
    if (font && fontMap[font]) {
      document.documentElement.style.setProperty("--font-editor", fontMap[font]);
    }

    // Listen for whitespace setting changes from other pages/tabs
    const onStorage = (e: StorageEvent) => {
      if (e.key === "cms-show-whitespace") {
        setShowWhitespace(e.newValue === "true");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Load custom editor stylesheet from content
  useEffect(() => {
    const styleId = "cms-editor-custom-styles";
    fetch("/api/content?path=editor-styles.css")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.content) return;
        let el = document.getElementById(styleId) as HTMLStyleElement | null;
        if (!el) {
          el = document.createElement("style");
          el.id = styleId;
          document.head.appendChild(el);
        }
        // Scope all rules under .ProseMirror so they only affect editor content
        const scoped = d.content
          .replace(/\/\*[\s\S]*?\*\//g, "") // strip comments
          .replace(/([^\n{}]+)\{/g, (_m: string, selector: string) => {
            const s = selector.trim();
            if (!s || s.startsWith("@")) return `${selector}{`;
            // Already scoped?
            if (s.startsWith(".ProseMirror")) return `${selector}{`;
            return `.ProseMirror ${s} {`;
          });
        el.textContent = scoped;
      })
      .catch(() => { /* no custom styles */ });
  }, []);

  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(newZoom);
    localStorage.setItem("cms-editor-zoom", String(newZoom));
  }, []);

  // Comment handlers
  const handleCommentClick = useCallback((commentId: string) => {
    setActiveCommentId(commentId);
    setShowComments(true);
  }, []);

  const handleAddCommentFromToolbar = useCallback(() => {
    if (!editorRef.current) return;
    const { from, to } = editorRef.current.state.selection;
    if (from === to) return; // no selection
    const text = editorRef.current.state.doc.textBetween(from, to);
    if (!text.trim()) return;
    setPendingHighlight(text);
    setShowComments(true);
  }, []);

  const handleAddComment = useCallback((comment: Comment) => {
    setComments((prev) => [...prev, comment]);
  }, []);

  const handleUpdateComment = useCallback((updated: Comment) => {
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }, []);

  const handleDeleteComment = useCallback((commentId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        listItem: {
          HTMLAttributes: {},
        },
      }),
      Image.configure({ inline: true, allowBase64: true }),
      Link.configure({ openOnClick: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({ placeholder: "Start writing your article..." }),
      Underline,
      MessageBox,
      VariableInline,
      ConditionalBlock,
      ConditionalMark,
      SnippetBlock,
      VideoEmbed,
      GlossaryTerm,
      StyledBlock,
      StyledMark,
      WhitespaceDecoration,
      ListNesting,
      CommentMark.configure({
        onCommentClick: handleCommentClick,
      }),
    ],
    content: initialHtml || initialContent || { type: "doc", content: [{ type: "paragraph" }] },
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      if (typeof window !== "undefined") (window as unknown as Record<string, unknown>).__tiptapEditor = editor;
      onEditorReady?.({
        getHTML: () => editor.getHTML(),
        getSelectedText: () => {
          const { from, to } = editor.state.selection;
          return editor.state.doc.textBetween(from, to);
        },
        commands: { setContent: (html: string) => editor.commands.setContent(html) },
      });
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON());
    },
    editorProps: {
      attributes: {
        spellcheck: "true",
        style: `min-height: 500px; padding: 24px; outline: none; font-size: ${zoom}%; line-height: 1.7;`,
        class: showWhitespace ? "show-whitespace" : "",
      },
      handleDOMEvents: {
        dragover: (_view, event) => {
          if (event.dataTransfer?.types.includes("application/cms-item")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
          return false;
        },
        drop: (view, event) => {
          const json = event.dataTransfer?.getData("application/cms-item");
          if (!json) return false;
          event.preventDefault();
          event.stopPropagation();
          try {
            const data = JSON.parse(json) as { type: string; name: string; file?: string };
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const pos = coords?.pos;
            const ed = editorRef.current;
            if (!ed || pos === undefined) return true;

            // Build the node to insert at the exact drop position
            const { state, dispatch } = view;
            const tr = state.tr;

            switch (data.type) {
              case "snippet": {
                const node = state.schema.nodes.snippetBlock?.create({ name: data.name });
                if (node) dispatch(tr.insert(pos, node));
                break;
              }
              case "variable": {
                const node = state.schema.nodes.variableInline?.create({ name: data.name });
                if (node) dispatch(tr.insert(pos, node));
                break;
              }
              case "image": {
                const src = `/api/content?path=${encodeURIComponent(data.file || "")}&raw=1`;
                const node = state.schema.nodes.image?.create({ src, alt: data.name });
                if (node) dispatch(tr.insert(pos, node));
                break;
              }
              case "article": {
                // Insert a cross-reference link: <a href="file">title</a>
                const linkMark = state.schema.marks.link?.create({ href: data.file || "" });
                if (linkMark) {
                  const textNode = state.schema.text(data.name, [linkMark]);
                  dispatch(tr.insert(pos, textNode));
                }
                break;
              }
            }
            ed.commands.focus();
          } catch { /* ignore invalid data */ }
          return true;
        },
      },
    },
  });

  // Update zoom via setOptions
  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        attributes: {
          spellcheck: "true",
          style: `min-height: 500px; padding: 24px; outline: none; font-size: ${zoom}%; line-height: 1.7;`,
        },
      },
    });
  }, [editor, zoom]);

  // Toggle whitespace decorations via ProseMirror plugin + CSS class for ¶
  useEffect(() => {
    if (!editor) return;
    try {
      const tr = editor.view.state.tr.setMeta(whitespaceKey, showWhitespace);
      editor.view.dispatch(tr);
    } catch { /* editor not ready */ }
    const el = editor.view.dom;
    if (showWhitespace) el.classList.add("show-whitespace");
    else el.classList.remove("show-whitespace");
  }, [editor, showWhitespace]);

  // Keep onSave ref in sync so keyboard handler always calls the latest
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "f") {
        e.preventDefault();
        setShowFindReplace((prev) => !prev);
      }
      if (mod && e.key === "s") {
        e.preventDefault();
        onSaveRef.current?.();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div
      style={{
        background: "var(--bg)",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div style={{ position: "relative" }}>
        {!ribbonCollapsed && (
          <Toolbar
            editor={editor}
            variables={variables}
            conditionTags={conditionTags}
            conditionColors={conditionColors}
            snippetNames={snippetNames}
            glossaryTerms={glossaryTerms}
            styles={styles}
            onToggleFindReplace={() => setShowFindReplace((p) => !p)}
            showStructure={showStructure}
            onToggleStructure={() => setShowStructure((p) => !p)}
            showTagBars={showTagBars}
            onToggleTagBars={() => setShowTagBars((p) => !p)}
            showComments={showComments}
            onToggleComments={() => setShowComments((p) => !p)}
            onAddComment={handleAddCommentFromToolbar}
            commentCount={comments.filter((c) => !c.resolved).length}
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            spellChecking={spellChecking}
            spellIssues={spellIssues}
            showSpellCheck={showSpellCheck}
            onSpellCheck={onSpellCheck}
            onSpellReplace={onSpellReplace}
            onSpellAddToDict={onSpellAddToDict}
            onSpellClose={onSpellClose}
            spellWordCount={spellWordCount}
            spellAddedCount={spellAddedCount}
          />
        )}
        <button
          onClick={() => setRibbonCollapsed((p) => !p)}
          className="ribbon-collapse-btn"
          title={ribbonCollapsed ? "Show toolbar" : "Hide toolbar"}
        >
          {ribbonCollapsed ? "▼" : "▲"}
        </button>
      </div>
      {editor && editor.isActive("table") && <TableToolbar editor={editor} />}
      {showFindReplace && editor && (
        <FindReplace editor={editor} onClose={() => setShowFindReplace(false)} />
      )}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, overflow: "auto", display: "flex" }}>
          {showTagBars && editor && (
            <BlockTagBar editor={editor} />
          )}
          <div style={{ flex: 1 }}>
            <EditorContent editor={editor} />
          </div>
        </div>
        {showStructure && editor && (
          <HtmlStructure editor={editor} />
        )}
      </div>
      <StatusBar
        editor={editor}
        zoom={zoom}
        onZoomChange={handleZoomChange}
      />
      {editor && (
        <CommentsDrawer
          editor={editor}
          open={showComments}
          onClose={() => setShowComments(false)}
          comments={comments}
          onAddComment={handleAddComment}
          onUpdateComment={handleUpdateComment}
          onDeleteComment={handleDeleteComment}
          activeCommentId={activeCommentId}
          onSetActiveComment={setActiveCommentId}
          pendingHighlight={pendingHighlight}
          onClearPending={() => setPendingHighlight(null)}
        />
      )}
    </div>
  );
}
