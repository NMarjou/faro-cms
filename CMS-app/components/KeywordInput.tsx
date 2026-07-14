"use client";

import { useState } from "react";
import Icon from "./Icon";

interface Props {
  value: string[];
  onChange: (keywords: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Free-text keyword chips — type and press Enter (or comma) to add, × to remove.
 * Unlike TagPicker (which picks from the controlled conditions vocabulary),
 * keywords are an open vocabulary: synonyms and alternate phrasings that should
 * find the article in search.
 */
export default function KeywordInput({ value, onChange, disabled, placeholder }: Props) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const kw = raw.trim();
    if (!kw || value.includes(kw)) { setDraft(""); return; }
    onChange([...value, kw]);
    setDraft("");
  };
  const remove = (kw: string) => onChange(value.filter((k) => k !== kw));

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {value.map((kw) => (
        <span
          key={kw}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "2px 6px 2px 8px",
            fontSize: 12,
            borderRadius: 999,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          {kw}
          {!disabled && (
            <button
              type="button"
              onClick={() => remove(kw)}
              aria-label={`Remove ${kw}`}
              title={`Remove ${kw}`}
              style={{ display: "inline-flex", border: "none", background: "none", cursor: "pointer", color: "var(--fg-muted)", padding: 0, lineHeight: 1 }}
            >
              <Icon name="x" size={11} />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          className="input"
          value={draft}
          onChange={(e) => {
            // A typed comma commits the keyword, so pasted lists work too.
            if (e.target.value.includes(",")) add(e.target.value.replace(/,/g, ""));
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(draft); }
            else if (e.key === "Backspace" && !draft && value.length) remove(value[value.length - 1]);
          }}
          onBlur={() => add(draft)}
          placeholder={placeholder || "Add keyword…"}
          style={{ fontSize: 12, padding: "2px 8px", width: 140 }}
        />
      )}
    </div>
  );
}
