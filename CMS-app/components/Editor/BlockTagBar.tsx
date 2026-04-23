"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ElementInfo {
  /** Actual HTML tag name (lowercase) */
  tag: string;
  /** Display label */
  label: string;
  /** Pixel offset from top of editor content area */
  top: number;
  /** Pixel height of this element */
  height: number;
  /** Nesting depth (0 = direct children of editor root) */
  depth: number;
  /** Color for the bar */
  color: string;
  /** Reference to the actual DOM element */
  el: HTMLElement;
  /** ProseMirror position (start), if resolvable */
  pmFrom: number | null;
  /** ProseMirror position (end), if resolvable */
  pmTo: number | null;
  /** Children indices */
  children: number[];
  /** Parent index (-1 = root) */
  parent: number;
}

/* ------------------------------------------------------------------ */
/*  Color + label maps keyed by HTML tag name                         */
/* ------------------------------------------------------------------ */

const TAG_COLORS: Record<string, string> = {
  // Headings — soft slate blue
  h1: "#8b9dc3", h2: "#8b9dc3", h3: "#a3b1cc", h4: "#b5c0d6", h5: "#c5cdde", h6: "#d3d9e6",
  // Text — neutral gray
  p: "#a0a7b0", span: "#b0b6be", em: "#b0b6be", strong: "#a0a7b0",
  i: "#b0b6be", b: "#a0a7b0", u: "#b0b6be", s: "#b0b6be",
  a: "#8ba5c3", code: "#b5a0b8", mark: "#c4b590",
  // Lists — soft sage
  ul: "#8fb5a0", ol: "#8fb5a0", li: "#a8c5b5",
  // Quotes & pre
  blockquote: "#c4b590", pre: "#b5a0b8",
  // Table — soft teal
  table: "#8bb5c3", thead: "#a0c5d0", tbody: "#b5d0d8",
  tr: "#b5d0d8", td: "#c5dae0", th: "#a0c5d0",
  // Media — muted lavender
  img: "#b0a0c5", video: "#c0a0a0", iframe: "#c0a0a0",
  // Structure — warm gray
  div: "#bab0a5", section: "#bab0a5", article: "#bab0a5",
  hr: "#c0c4c8", br: "#d0d3d6",
  // Figures
  figure: "#b8a5c0", figcaption: "#c8b8cf",
};

/** Tags with light enough backgrounds to need dark text */
const DARK_TEXT_TAGS = new Set(["h5", "h6", "li", "td", "br", "c5dae0"]);

function getColor(tag: string): string {
  return TAG_COLORS[tag] || "#94a3b8";
}

function getLabel(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return tag;
  const dataType = el.getAttribute("data-type");
  if (dataType) {
    return `${tag}.${dataType}`;
  }
  return tag;
}

/* ------------------------------------------------------------------ */
/*  Collect all elements from the editor DOM tree                     */
/* ------------------------------------------------------------------ */

const SKIP_TAGS = new Set(["svg", "path", "circle", "line", "rect", "polygon", "g", "defs", "clippath"]);

function collectElements(editor: Editor, _scrollContainer: HTMLElement): ElementInfo[] {
  const elements: ElementInfo[] = [];
  const view = editor.view;
  const editorEl = view.dom;
  const editorRect = editorEl.getBoundingClientRect();

  function walk(node: HTMLElement, depth: number, parentIdx: number) {
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as HTMLElement;
      if (!child.tagName) continue;
      const tag = child.tagName.toLowerCase();

      if (SKIP_TAGS.has(tag) || tag === "script" || tag === "style") continue;
      const rect = child.getBoundingClientRect();
      if (rect.height < 1 && tag !== "br" && tag !== "hr") continue;

      // Position relative to the editor element's top — since gutter and editor
      // are siblings inside the same scroll container, both scroll together,
      // so we just need the offset from the editor's own top edge.
      const top = rect.top - editorRect.top;
      const height = Math.max(rect.height, 2);

      let pmFrom: number | null = null;
      let pmTo: number | null = null;
      try {
        const pos = view.posAtDOM(child, 0);
        if (pos !== undefined && pos !== null) {
          pmFrom = pos;
          const endPos = view.posAtDOM(child, child.childNodes.length);
          if (endPos !== undefined && endPos !== null) {
            pmTo = endPos;
          }
        }
      } catch { /* can't resolve */ }

      const idx = elements.length;
      const info: ElementInfo = {
        tag,
        label: getLabel(child),
        top,
        height,
        depth,
        color: getColor(tag),
        el: child,
        pmFrom,
        pmTo,
        children: [],
        parent: parentIdx,
      };
      elements.push(info);

      if (parentIdx >= 0) {
        elements[parentIdx].children.push(idx);
      }

      walk(child, depth + 1, idx);
    }
  }

  walk(editorEl, 0, -1);
  return elements;
}

/* ------------------------------------------------------------------ */
/*  Highlight helpers                                                  */
/* ------------------------------------------------------------------ */

function clearHighlight() {
  document.querySelectorAll(".block-tag-highlight").forEach((el) => {
    el.classList.remove("block-tag-highlight");
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface BlockTagBarProps {
  editor: Editor;
}

/** Width of one depth column in the gutter */
const COL_WIDTH = 18;

export default function BlockTagBar({ editor }: BlockTagBarProps) {
  const [elements, setElements] = useState<ElementInfo[]>([]);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [activeFrom, setActiveFrom] = useState<number | null>(null);
  const [isDark, setIsDark] = useState(false);
  const gutterRef = useRef<HTMLDivElement>(null);

  // Track theme changes
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.getAttribute("data-theme") === "dark");
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Inject highlight style once
  useEffect(() => {
    const id = "block-tag-highlight-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      .block-tag-highlight {
        outline: 2px solid #6366f1 !important;
        outline-offset: 1px;
        background: rgba(99, 102, 241, 0.06) !important;
        border-radius: 3px;
        transition: outline-color 0.15s, background 0.15s;
      }
    `;
    document.head.appendChild(style);
  }, []);

  // Clear highlight on selection change
  useEffect(() => {
    if (!editor) return;
    const handler = () =>
      setTimeout(() => {
        setSelectedIdx((prev) => {
          if (prev !== null) clearHighlight();
          return null;
        });
      }, 0);
    editor.on("selectionUpdate", handler);
    return () => { editor.off("selectionUpdate", handler); };
  }, [editor]);

  const refresh = useCallback(() => {
    if (!editor?.view?.dom) return;
    const scrollEl = gutterRef.current?.parentElement;
    if (!scrollEl) return;
    setElements(collectElements(editor, scrollEl));
    const { from } = editor.state.selection;
    setActiveFrom(from);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const timer = setTimeout(refresh, 50);
    editor.on("update", refresh);
    editor.on("selectionUpdate", refresh);
    return () => {
      clearTimeout(timer);
      editor.off("update", refresh);
      editor.off("selectionUpdate", refresh);
    };
  }, [editor, refresh]);

  /* ---- Click handler ---- */
  const handleTagClick = (info: ElementInfo, idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearHighlight();

    info.el.classList.add("block-tag-highlight");
    setSelectedIdx(idx);

    if (info.pmFrom !== null) {
      const { state, dispatch } = editor.view;
      try {
        const from = info.pmFrom;
        const to = info.pmTo ?? from;
        const safeFrom = Math.max(0, Math.min(from, state.doc.content.size));
        const safeTo = Math.max(safeFrom, Math.min(to, state.doc.content.size));
        const sel = TextSelection.create(state.doc, safeFrom, safeTo);
        dispatch(state.tr.setSelection(sel));
      } catch { /* selection creation can fail */ }
    }
    editor.commands.focus();
  };

  /* ---- Layout ---- */
  const maxDepth = elements.reduce((max, el) => Math.max(max, el.depth), 0);
  const gutterWidth = Math.max(COL_WIDTH, (maxDepth + 1) * COL_WIDTH);

  // Which top-level element contains the cursor?
  const activeRootIdx = activeFrom !== null
    ? elements.findIndex(
        (el) =>
          el.depth === 0 &&
          el.pmFrom !== null &&
          el.pmTo !== null &&
          activeFrom >= el.pmFrom &&
          activeFrom <= el.pmTo
      )
    : -1;

  // Collect all indices in the active root's subtree
  const activeSet = new Set<number>();
  if (activeRootIdx >= 0) {
    const queue = [activeRootIdx];
    while (queue.length) {
      const cur = queue.pop()!;
      activeSet.add(cur);
      for (const c of elements[cur].children) queue.push(c);
    }
  }

  return (
    <div
      ref={gutterRef}
      className="block-tag-gutter"
      style={{
        width: gutterWidth,
        minWidth: gutterWidth,
        position: "relative",
        borderRight: "1px solid var(--border)",
        background: "var(--bg-muted, #f8f9fa)",
        overflow: "visible",
        cursor: "default",
        flexShrink: 0,
        alignSelf: "stretch",
        userSelect: "none",
      }}
    >
      {elements.map((info, i) => {
        const isHovered = hoveredIdx === i;
        const isSelected = selectedIdx === i;
        const isActive = activeSet.has(i);
        const left = info.depth * COL_WIDTH;
        const tagHeight = Math.max(info.height, 16);
        // In dark mode, always use light text; in light mode, some tags need dark text
        const useDarkText = !isDark && DARK_TEXT_TAGS.has(info.tag);

        // Higher base opacity in dark mode for readability
        const opacity = isSelected ? 0.95
          : isHovered ? 0.8
          : isActive ? (isDark ? 0.65 : 0.5)
          : isDark ? 0.45 : 0.25;

        return (
          <div
            key={`${i}-${info.tag}-${info.top}`}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            onClick={(e) => handleTagClick(info, i, e)}
            title={`<${info.tag}> — click to select`}
            style={{
              position: "absolute",
              top: info.top,
              left,
              width: COL_WIDTH - 3,
              height: tagHeight,
              background: info.color,
              opacity,
              borderRadius: 3,
              boxShadow: isSelected
                ? `0 0 0 2px ${info.color}, inset 0 0 0 1px rgba(255,255,255,0.3)`
                : isHovered
                  ? `inset 0 0 0 1px rgba(255,255,255,0.2)`
                  : undefined,
              cursor: "pointer",
              transition: "opacity 0.1s, box-shadow 0.1s",
              zIndex: info.depth + 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              boxSizing: "border-box",
            }}
          >
            <span
              style={{
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
                fontSize: 9,
                fontWeight: 700,
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                color: useDarkText ? "#1e293b" : "#fff",
                lineHeight: 1,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                paddingInline: 4,
                textShadow: useDarkText ? "none" : "0 0.5px 1px rgba(0,0,0,0.3)",
              }}
            >
              {info.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
