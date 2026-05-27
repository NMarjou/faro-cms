"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent, BubbleMenu, type Editor as TipTapEditor } from "@tiptap/react";
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
import { SuggestionDecoration, suggestionDecorationKey } from "./extensions/SuggestionDecoration";
import { ListNesting } from "./extensions/ListNesting";
import { CommentMark } from "./extensions/CommentMark";
import type { Comment } from "./CommentsDrawer";
import ReviewSidebar, { type ReviewTab } from "./ReviewSidebar";
import { useCurrentUser } from "../CurrentUserProvider";
import type { Suggestion } from "@/lib/types";

import type { Variables, GlossaryTerm as GlossaryTermType, ContentStyle } from "@/lib/types";

interface SpellIssue {
  word: string;
  suggestions: string[];
  count: number;
}

interface EditorProps {
  /** Article path — used as the key for persisting comments via /api/article/comments */
  filePath?: string;
  /** Emails assigned to review this article (from the TOC entry). */
  assignedTo?: string[];
  /** Emails of reviewers who have already marked this article's review done. */
  reviewsDone?: string[];
  /** Bubbled up after a Mark-as-done flip so the page can refresh its TOC view. */
  onReviewDoneChanged?: (next: string[]) => void;
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
  // Toolbar mode — passed through to the ribbon. "review" = contributor's
  // limited variant (Comment + Suggest Changes only).
  mode?: "full" | "review";
  onSuggestChanges?: () => void;
}

export default function Editor({
  filePath,
  assignedTo,
  reviewsDone,
  onReviewDoneChanged,
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
  mode = "full",
  onSuggestChanges,
}: EditorProps) {
  const isReview = mode === "review";
  const [showFindReplace, setShowFindReplace] = useState(false);
  // Contributors get a true-WYSIWYG view — no whitespace markers, no HTML
  // tag bars, no structure panel — regardless of their persisted prefs.
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const [showTagBars, setShowTagBars] = useState(!isReview);
  const [ribbonCollapsed, setRibbonCollapsed] = useState(false);
  const [zoom, setZoom] = useState(100);
  // Unified review sidebar — single drawer with two tabs (Comments +
  // Suggested changes). Active tab driven by which entry-point the user
  // hit (toolbar button or bubble-menu pill).
  const [showReviewSidebar, setShowReviewSidebar] = useState(false);
  const [reviewTab, setReviewTab] = useState<ReviewTab>("comments");
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [pendingHighlight, setPendingHighlight] = useState<string | null>(null);
  // Suggestion state — list of all suggestions on this article + the
  // captured selection snapshot when the user clicks "Suggest Changes".
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [pendingSuggestion, setPendingSuggestion] = useState<{
    text: string;
    occurrenceIndex: number;
  } | null>(null);
  // Active suggestion id — set when the user clicks a highlighted span in
  // the body, consumed by the drawer to scroll the matching card into view
  // and pulse it briefly. Always reset to null after the pulse completes
  // so re-clicking the same span re-triggers the scroll.
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);
  // Mirrored copy of the editor's latest non-empty selection. Used as a
  // fallback when a bubble-menu button click momentarily steals focus and
  // collapses the selection before our handler reads editor.state.
  const lastSelectionRef = useRef<{
    from: number;
    to: number;
    text: string;
  } | null>(null);

  // Browser-level selection probe — last resort for the contributor's
  // readonly editor. ProseMirror often doesn't promote DOM selections inside
  // a contenteditable=false element into state.selection, so we fall back to
  // window.getSelection() and walk the editor DOM to compute the occurrence
  // index. Returns null if there's no usable selection inside the editor.
  const readDomSelection = useCallback((): { text: string; occurrenceIndex: number } | null => {
    if (typeof window === "undefined") return null;
    const ed = editorRef.current;
    if (!ed) return null;
    const editorEl = ed.view.dom;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const text = range.toString();
    if (!text.trim()) return null;
    if (!editorEl.contains(range.commonAncestorContainer)) return null;
    // Count occurrences of `text` in the editor's textContent before the
    // selection's start, to pin the right span when the same string appears
    // multiple times.
    const before = document.createRange();
    before.setStart(editorEl, 0);
    before.setEnd(range.startContainer, range.startOffset);
    const beforeText = before.toString();
    let count = 0;
    let cursor = 0;
    while (true) {
      const idx = beforeText.indexOf(text, cursor);
      if (idx === -1) break;
      count += 1;
      cursor = idx + text.length;
    }
    return { text, occurrenceIndex: count };
  }, []);
  const editorRef = useRef<TipTapEditor | null>(null);
  const { user: currentUser } = useCurrentUser();
  // Friendly author label: full name when known, else the local-part of the
  // identity email, else "Anonymous". Stored with every new comment + reply.
  const authorLabel =
    currentUser?.name ||
    currentUser?.email?.split("@")[0] ||
    "Anonymous";

  // ── Comment persistence ────────────────────────────────────────────────
  // Sidecar JSON file per article via /api/article/comments. We load once
  // when filePath is known, then persist on every comment-list change.

  // Initial load.
  useEffect(() => {
    if (!filePath) {
      setCommentsLoaded(true);
      return;
    }
    let cancelled = false;
    fetch(`/api/article/comments?path=${encodeURIComponent(filePath)}`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d: { comments?: Comment[] }) => {
        if (cancelled) return;
        setComments(Array.isArray(d.comments) ? d.comments : []);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      })
      .finally(() => {
        if (!cancelled) setCommentsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Persist on change. Skip until the initial load is complete so we don't
  // overwrite the file with an empty array on first render.
  useEffect(() => {
    if (!filePath || !commentsLoaded) return;
    const controller = new AbortController();
    fetch("/api/article/comments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, comments }),
      signal: controller.signal,
    }).catch(() => {
      /* network / abort — surfaced in dev log if needed */
    });
    return () => controller.abort();
  }, [filePath, commentsLoaded, comments]);

  // ── Suggestion persistence ────────────────────────────────────────────
  // Reads only — appends and accept/reject happen via dedicated endpoints
  // so we don't need a PUT-everything-on-change pattern like comments.
  const refreshSuggestions = useCallback(async () => {
    if (!filePath) return;
    try {
      const res = await fetch(`/api/article/suggestions?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) return;
      const d: { suggestions?: Suggestion[] } = await res.json();
      setSuggestions(Array.isArray(d.suggestions) ? d.suggestions : []);
    } catch {
      /* ignore */
    }
  }, [filePath]);

  useEffect(() => {
    refreshSuggestions();
  }, [refreshSuggestions]);

  // Load user preferences from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("cms-editor-zoom");
    if (saved) setZoom(Number(saved));
    // Whitespace markers are a tech-writer affordance only. Skip the lookup
    // entirely in review mode so a contributor never sees them even if they
    // (or a shared profile) flipped the setting on.
    if (!isReview) {
      const ws = localStorage.getItem("cms-show-whitespace");
      if (ws === "true") setShowWhitespace(true);
    }

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

    if (isReview) return; // no whitespace listener in review mode either

    // Listen for whitespace setting changes from other pages/tabs
    const onStorage = (e: StorageEvent) => {
      if (e.key === "cms-show-whitespace") {
        setShowWhitespace(e.newValue === "true");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [isReview]);

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

  // Open the unified review sidebar to a specific tab.
  const openReview = useCallback((tab: ReviewTab) => {
    setReviewTab(tab);
    setShowReviewSidebar(true);
  }, []);

  // Comment handlers
  const handleCommentClick = useCallback((commentId: string) => {
    setActiveCommentId(commentId);
    openReview("comments");
  }, [openReview]);

  const handleAddCommentFromToolbar = useCallback(() => {
    // Priority chain for picking up the highlighted text:
    //   1. live ProseMirror state.selection (works when the editor is editable)
    //   2. lastSelectionRef (covers focus-steal between mousedown and click)
    //   3. window.getSelection() (the readonly-editor case — ProseMirror
    //      doesn't promote DOM selections to its state)
    let text = "";
    if (editorRef.current) {
      const { from, to } = editorRef.current.state.selection;
      if (from !== to) {
        text = editorRef.current.state.doc.textBetween(from, to);
      }
    }
    if (!text.trim() && lastSelectionRef.current) {
      text = lastSelectionRef.current.text;
    }
    if (!text.trim()) {
      const dom = readDomSelection();
      if (dom) text = dom.text;
    }
    if (text.trim()) {
      setPendingHighlight(text);
    }
    openReview("comments");
  }, [openReview, readDomSelection]);

  const handleAddComment = useCallback((comment: Comment) => {
    setComments((prev) => [...prev, comment]);
  }, []);

  const handleUpdateComment = useCallback((updated: Comment) => {
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }, []);

  const handleDeleteComment = useCallback((commentId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  }, []);

  // ── Suggested-edit handlers ────────────────────────────────────────────
  // Open the ReviewSidebar's Suggestions tab with a snapshot of the current
  // selection. We also compute which occurrence of the text this is so the
  // tech writer's accept logic (Phase 3b) can target the right span even
  // if the same text appears multiple times in the article.
  const handleOpenSuggestion = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) {
      openReview("suggestions");
      return;
    }
    // Priority chain (mirrors handleAddCommentFromToolbar):
    //   1. live ProseMirror selection
    //   2. lastSelectionRef snapshot
    //   3. window.getSelection() — the readonly-editor case
    let text = "";
    let occurrenceIndex = 0;

    const { from: liveFrom, to: liveTo } = ed.state.selection;
    if (liveFrom !== liveTo) {
      text = ed.state.doc.textBetween(liveFrom, liveTo);
      if (text.trim()) {
        const before = ed.state.doc.textBetween(0, liveFrom, "\n", "\n");
        let count = 0;
        let cursor = 0;
        while (true) {
          const found = before.indexOf(text, cursor);
          if (found === -1) break;
          count += 1;
          cursor = found + text.length;
        }
        occurrenceIndex = count;
      } else {
        text = "";
      }
    }

    if (!text && lastSelectionRef.current) {
      text = lastSelectionRef.current.text;
      const before = ed.state.doc.textBetween(0, lastSelectionRef.current.from, "\n", "\n");
      let count = 0;
      let cursor = 0;
      while (true) {
        const found = before.indexOf(text, cursor);
        if (found === -1) break;
        count += 1;
        cursor = found + text.length;
      }
      occurrenceIndex = count;
    }

    if (!text) {
      const dom = readDomSelection();
      if (dom) {
        text = dom.text;
        occurrenceIndex = dom.occurrenceIndex;
      }
    }

    if (!text.trim()) {
      openReview("suggestions");
      return;
    }
    setPendingSuggestion({ text, occurrenceIndex });
    openReview("suggestions");
  }, [openReview, readDomSelection]);

  const handleSubmitSuggestion = useCallback(
    async (data: { suggestedText: string; note: string }) => {
      if (!filePath || !pendingSuggestion) {
        throw new Error("No article context");
      }
      const res = await fetch("/api/article/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          suggestion: {
            author: currentUser?.email || "anonymous",
            authorName: currentUser?.name,
            originalText: pendingSuggestion.text,
            suggestedText: data.suggestedText,
            occurrenceIndex: pendingSuggestion.occurrenceIndex,
            note: data.note,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Submit failed");
      }
      // Refresh the list so the contributor sees their new entry land in
      // the sidebar's Suggestions tab without needing to reopen the drawer.
      await refreshSuggestions();
    },
    [filePath, pendingSuggestion, currentUser?.email, currentUser?.name, refreshSuggestions]
  );

  // ── Mark-review-done flow ──────────────────────────────────────────────
  // Only relevant to the contributor identity for articles they were
  // assigned to review. The button is disabled while anything is still
  // outstanding so we can't get into a "I marked done but there are
  // unresolved comments" state.
  const lowerEmail = currentUser?.email?.toLowerCase() || "";
  const isAssignedReviewer =
    !!lowerEmail &&
    (assignedTo || []).some((e) => e.toLowerCase() === lowerEmail);
  const hasMarkedReviewDone =
    isAssignedReviewer &&
    (reviewsDone || []).some((e) => e.toLowerCase() === lowerEmail);
  const unresolvedComments = comments.filter((c) => !c.resolved).length;
  const pendingSuggestionsForGate = suggestions.filter((s) => s.status === "pending").length;
  const markDoneBlockedReason: string | null = (() => {
    if (hasMarkedReviewDone) return null; // already done — button reopens
    if (unresolvedComments > 0)
      return `Resolve ${unresolvedComments} open comment${unresolvedComments === 1 ? "" : "s"} first`;
    if (pendingSuggestionsForGate > 0)
      return `${pendingSuggestionsForGate} suggestion${pendingSuggestionsForGate === 1 ? "" : "s"} still pending review`;
    return null;
  })();

  // Tech-writer accept/reject of a contributor's suggestion. Accept writes
  // the diff to the article HTML on the working branch; reject just marks
  // the sidecar entry. Either way we refresh the list afterward.
  const handleResolveSuggestion = useCallback(
    async (id: string, action: "accept" | "reject") => {
      if (!filePath) throw new Error("No article context");
      const res = await fetch("/api/article/suggestions/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          id,
          action,
          resolverEmail: currentUser?.email,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed");
      }
      await refreshSuggestions();
    },
    [filePath, refreshSuggestions, currentUser?.email]
  );

  const handleToggleReviewDone = useCallback(async () => {
    if (!filePath || !currentUser?.email) return;
    try {
      const res = await fetch("/api/article/review-done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          reviewerEmail: currentUser.email,
          done: !hasMarkedReviewDone,
        }),
      });
      if (!res.ok) return;
      const data: { reviewsDone?: string[] } = await res.json();
      onReviewDoneChanged?.(data.reviewsDone || []);
    } catch {
      /* surfaced in dev log */
    }
  }, [filePath, currentUser?.email, hasMarkedReviewDone, onReviewDoneChanged]);

  const editor = useEditor({
    // Defer initial render to client mount to skip TipTap's SSR-safety
    // dance under React 18 strict mode (silences the "SSR detected" warning
    // and avoids a wasted re-render).
    immediatelyRender: false,
    // Contributors review articles, they don't write them. Read-only blocks
    // typing/pasting/deleting but keeps selection (so they can highlight a
    // span and comment on it). Phase 3's "Suggest changes" mode will lift
    // this temporarily when the contributor proposes edits.
    editable: !isReview,
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
      SuggestionDecoration,
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
    // Mirror every selection into a ref so bubble-menu / toolbar handlers
    // have a snapshot to fall back to if the click momentarily collapses
    // the editor selection (focus-stealing buttons).
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (from === to) return;
      const text = editor.state.doc.textBetween(from, to);
      if (!text.trim()) return;
      lastSelectionRef.current = { from, to, text };
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

  // If the user's role flips mid-session (identity switch in Settings),
  // toggle the editor's editability without recreating it so editor state
  // (selection, undo history, scroll position) is preserved.
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable === !isReview) return;
    editor.setEditable(!isReview);
  }, [editor, isReview]);

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

  // Push pending suggestions into the decoration plugin so the tech writer
  // sees each proposed-edit span underlined in the article body. Re-runs
  // whenever the sidecar's pending list shifts (submit / accept / reject).
  useEffect(() => {
    if (!editor) return;
    const highlights = suggestions
      .filter((s) => s.status === "pending")
      .map((s) => ({
        id: s.id,
        originalText: s.originalText,
        occurrenceIndex: s.occurrenceIndex ?? 0,
      }));
    try {
      const tr = editor.view.state.tr.setMeta(suggestionDecorationKey, highlights);
      editor.view.dispatch(tr);
    } catch { /* editor not ready yet */ }
  }, [editor, suggestions]);

  // Click-to-jump: when the user clicks a highlighted suggestion span in the
  // body, open the review drawer on the Suggestions tab and pulse the
  // matching card. Uses event delegation on the editor's DOM so we don't
  // need per-span listeners.
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const hit = target.closest<HTMLElement>(".suggestion-highlight");
      if (!hit) return;
      const id = hit.getAttribute("data-suggestion-id");
      if (!id) return;
      e.preventDefault();
      setActiveSuggestionId(id);
      openReview("suggestions");
    };
    root.addEventListener("click", handler);
    return () => root.removeEventListener("click", handler);
  }, [editor, openReview]);

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
            showComments={showReviewSidebar && reviewTab === "comments"}
            onToggleComments={() => {
              if (showReviewSidebar && reviewTab === "comments") setShowReviewSidebar(false);
              else openReview("comments");
            }}
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
            mode={mode}
            onSuggestChanges={onSuggestChanges || handleOpenSuggestion}
            pendingSuggestionsCount={suggestions.filter((s) => s.status === "pending").length}
            showSuggestions={showReviewSidebar && reviewTab === "suggestions"}
            canMarkReviewDone={mode === "review" && isAssignedReviewer}
            reviewDone={hasMarkedReviewDone}
            markDoneBlockedReason={markDoneBlockedReason}
            onMarkReviewDone={handleToggleReviewDone}
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
          {!isReview && showTagBars && editor && (
            <BlockTagBar editor={editor} />
          )}
          <div style={{ flex: 1 }}>
            <EditorContent editor={editor} />
            {/* Contributor-only floating menu: shown when a non-empty span
                is selected. Two pills — Comment + Suggest Changes — mirror
                the contributor's toolbar but with selection context. */}
            {isReview && editor && (
              <BubbleMenu
                editor={editor}
                tippyOptions={{ duration: 100, placement: "top" }}
                shouldShow={({ from, to }) => from !== to}
              >
                <div className="bubble-menu">
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleAddCommentFromToolbar}
                    title="Comment on selection"
                    className="bubble-menu-btn"
                  >
                    <i className="ph ph-chat-circle" style={{ fontSize: 14 }} />
                    Comment
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleOpenSuggestion}
                    title="Propose a replacement for the selected span"
                    className="bubble-menu-btn gold"
                  >
                    <i className="ph ph-git-pull-request" style={{ fontSize: 14 }} />
                    Suggest changes
                  </button>
                </div>
              </BubbleMenu>
            )}
          </div>
        </div>
        {!isReview && showStructure && editor && (
          <HtmlStructure editor={editor} />
        )}
      </div>
      <StatusBar
        editor={editor}
        zoom={zoom}
        onZoomChange={handleZoomChange}
      />
      {editor && (
        <ReviewSidebar
          open={showReviewSidebar}
          onClose={() => setShowReviewSidebar(false)}
          activeTab={reviewTab}
          onChangeTab={setReviewTab}
          editor={editor}
          comments={comments}
          onAddComment={handleAddComment}
          onUpdateComment={handleUpdateComment}
          onDeleteComment={handleDeleteComment}
          activeCommentId={activeCommentId}
          onSetActiveComment={setActiveCommentId}
          pendingHighlight={pendingHighlight}
          onClearPending={() => setPendingHighlight(null)}
          authorLabel={authorLabel}
          suggestions={suggestions}
          pendingSuggestion={pendingSuggestion}
          onSubmitSuggestion={handleSubmitSuggestion}
          onClearPendingSuggestion={() => setPendingSuggestion(null)}
          canResolveSuggestions={mode !== "review"}
          onResolveSuggestion={handleResolveSuggestion}
          activeSuggestionId={activeSuggestionId}
          onClearActiveSuggestion={() => setActiveSuggestionId(null)}
        />
      )}
    </div>
  );
}
