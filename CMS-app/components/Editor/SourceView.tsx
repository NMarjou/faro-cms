"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface SourceViewProps {
  value: string;
  onChange: (html: string) => void;
  /** Text to find and select in the source when the component mounts */
  highlightText?: string;
}

// Catppuccin Mocha theme
const THEME = {
  tag: "#89b4fa",
  attr: "#f9e2af",
  value: "#a6e3a1",
  text: "#cdd6f4",
  bracket: "#6c7086",
  comment: "#6c7086",
};

/** Syntax-highlight HTML — Catppuccin Mocha, single-pass tokenizer */
function highlightHtml(source: string): string {
  const out: string[] = [];
  let i = 0;

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const span = (color: string, text: string, italic = false) =>
    `<span style="color:${color}${italic ? ";font-style:italic" : ""}">${esc(text)}</span>`;

  while (i < source.length) {
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      const comment = end === -1 ? source.slice(i) : source.slice(i, end + 3);
      out.push(span(THEME.comment, comment, true));
      i += comment.length;
      continue;
    }

    if (source[i] === "<") {
      const closing = source[i + 1] === "/";
      const tagStart = i;
      let j = i + 1;
      if (closing) j++;

      let tagName = "";
      while (j < source.length && /[\w-]/.test(source[j])) { tagName += source[j]; j++; }

      out.push(span(THEME.bracket, source.slice(tagStart, tagStart + (closing ? 2 : 1))));
      if (tagName) out.push(span(THEME.tag, tagName));

      while (j < source.length && source[j] !== ">") {
        if (source[j] === "/" && j + 1 < source.length && source[j + 1] === ">") break;

        if (/\s/.test(source[j])) {
          let ws = "";
          while (j < source.length && /\s/.test(source[j])) { ws += source[j]; j++; }
          out.push(esc(ws));
          continue;
        }

        let attrName = "";
        while (j < source.length && /[\w-]/.test(source[j])) { attrName += source[j]; j++; }
        if (attrName) out.push(span(THEME.attr, attrName));

        if (j < source.length && source[j] === "=") { out.push(span(THEME.bracket, "=")); j++; }

        if (j < source.length && (source[j] === '"' || source[j] === "'")) {
          const q = source[j];
          let val = q;
          j++;
          while (j < source.length && source[j] !== q) { val += source[j]; j++; }
          if (j < source.length) { val += q; j++; }
          out.push(span(THEME.value, val));
          continue;
        }

        if (j < source.length && source[j] !== ">" && source[j] !== "/" && !/\s/.test(source[j]) && !attrName) {
          out.push(esc(source[j]));
          j++;
        }
      }

      if (j < source.length) {
        if (source[j] === "/" && j + 1 < source.length && source[j + 1] === ">") {
          out.push(span(THEME.bracket, "/>")); j += 2;
        } else if (source[j] === ">") {
          out.push(span(THEME.bracket, ">")); j++;
        }
      }

      i = j;
      continue;
    }

    let text = "";
    while (i < source.length && source[i] !== "<") { text += source[i]; i++; }
    if (text) out.push(esc(text));
  }

  return out.join("");
}

export default function SourceView({ value, onChange, highlightText }: SourceViewProps) {
  const [localValue, setLocalValue] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  // Sync parent when value changes from outside (e.g. initial load)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Highlight selected text from visual editor
  useEffect(() => {
    if (!highlightText || !textareaRef.current) return;
    const idx = value.indexOf(highlightText);
    if (idx === -1) return;
    const ta = textareaRef.current;
    // Use requestAnimationFrame to ensure textarea is rendered
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(idx, idx + highlightText.length);
      // Scroll the selection into view
      const lineHeight = 13 * 1.6; // fontSize * lineHeight
      const linesBefore = value.slice(0, idx).split("\n").length - 1;
      ta.scrollTop = Math.max(0, linesBefore * lineHeight - 100);
    });
  }, [highlightText, value]);

  // Report changes to parent on each edit
  const handleInput = useCallback((newVal: string) => {
    setLocalValue(newVal);
    onChange(newVal);
  }, [onChange]);

  const handleScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const sharedStyle: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    lineHeight: 1.6,
    padding: 16,
    margin: 0,
    border: "none",
    whiteSpace: "pre-wrap",
    wordWrap: "break-word",
    tabSize: 2,
    width: "100%",
    height: "100%",
    minHeight: 400,
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        background: "#1e1e2e",
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #313244",
          background: "#11111b",
          display: "flex",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "#cdd6f4" }}>
          HTML Source
        </span>
      </div>

      <div style={{ position: "relative", overflow: "auto", flex: 1, minHeight: 0 }}>
        <pre
          ref={preRef}
          aria-hidden="true"
          style={{
            ...sharedStyle,
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none",
            color: "#cdd6f4",
            background: "transparent",
            overflow: "hidden",
          }}
          dangerouslySetInnerHTML={{ __html: highlightHtml(localValue) + "\n" }}
        />

        <textarea
          ref={textareaRef}
          value={localValue}
          onChange={(e) => handleInput(e.target.value)}
          onScroll={handleScroll}
          spellCheck={false}
          style={{
            ...sharedStyle,
            position: "relative",
            color: "transparent",
            caretColor: "#cdd6f4",
            background: "transparent",
            resize: "vertical",
            outline: "none",
            WebkitTextFillColor: "transparent",
          }}
        />
      </div>
    </div>
  );
}
