"use client";

import { useState } from "react";
import Icon from "./Icon";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Known label vocabulary (the merged conditions tags). */
  available: string[];
  /** Per-tag colors (from conditions) for chip tinting. */
  colors?: Record<string, string>;
  disabled?: boolean;
}

/**
 * Label picker — selected tags render as colored, removable chips; new labels
 * are added from the known vocabulary (a dropdown of the not-yet-selected
 * tags). Tags already on the article that aren't in the vocabulary still show
 * as chips so nothing is silently dropped.
 */
export default function TagPicker({ value, onChange, available, colors = {}, disabled }: Props) {
  const [adding, setAdding] = useState("");

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));
  const add = (tag: string) => {
    if (!tag || value.includes(tag)) return;
    onChange([...value, tag]);
    setAdding("");
  };

  const remaining = available.filter((t) => !value.includes(t));

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {value.length === 0 && (
        <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>No labels</span>
      )}
      {value.map((tag) => {
        const color = colors[tag];
        return (
          <span
            key={tag}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "2px 6px 2px 8px",
              fontSize: 12,
              borderRadius: 999,
              background: color ? `${color}22` : "var(--bg-secondary)",
              border: `1px solid ${color ? `${color}66` : "var(--border)"}`,
            }}
          >
            {color && <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />}
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remove ${tag}`}
                title={`Remove ${tag}`}
                style={{ display: "inline-flex", border: "none", background: "none", cursor: "pointer", color: "var(--fg-muted)", padding: 0, lineHeight: 1 }}
              >
                <Icon name="x" size={11} />
              </button>
            )}
          </span>
        );
      })}
      {!disabled && remaining.length > 0 && (
        <select
          className="input"
          value={adding}
          onChange={(e) => add(e.target.value)}
          style={{ fontSize: 12, padding: "2px 6px", width: "auto", cursor: "pointer" }}
          title="Add a label"
        >
          <option value="">+ Add label…</option>
          {remaining.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      )}
    </div>
  );
}
