"use client";

import { useState, useEffect, useRef } from "react";
import type { ConditionsConfig } from "@/lib/types";

const DEFAULT_COLORS = [
  "#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
];

export default function PlatformSettingsPage() {
  const [tags, setTags] = useState<string[]>([]);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // CSS editor state
  const [css, setCss] = useState("");
  const [cssOriginal, setCssOriginal] = useState("");
  const [cssLoaded, setCssLoaded] = useState(false);
  const [cssSaving, setCssSaving] = useState(false);
  const [cssMessage, setCssMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Load conditions
    fetch("/api/content?path=conditions.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const c: ConditionsConfig = d.content ? JSON.parse(d.content) : d;
        setTags(c.tags || []);
        setColors(c.colors || {});
        setLoaded(true);
      })
      .catch(() => setLoaded(true));

    // Load custom CSS
    fetch("/api/content?path=editor-styles.css")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.content) {
          setCss(d.content);
          setCssOriginal(d.content);
        }
        setCssLoaded(true);
      })
      .catch(() => setCssLoaded(true));
  }, []);

  const saveConditions = async () => {
    setSaving(true);
    try {
      const data: ConditionsConfig = { tags, colors };
      const res = await fetch("/api/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "conditions.json",
          content: JSON.stringify(data, null, 2),
          message: "Update condition tags",
        }),
      });
      if (res.ok) {
        setMessage("Saved");
        setTimeout(() => setMessage(null), 2000);
      }
    } catch {
      setMessage("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const saveCss = async () => {
    setCssSaving(true);
    try {
      const res = await fetch("/api/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "editor-styles.css",
          content: css,
          message: "Update editor stylesheet",
        }),
      });
      if (res.ok) {
        setCssOriginal(css);
        setCssMessage("Stylesheet saved");
        setTimeout(() => setCssMessage(null), 2000);
      }
    } catch {
      setCssMessage("Failed to save");
    } finally {
      setCssSaving(false);
    }
  };

  const handleCssImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCss(reader.result);
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-imported
    e.target.value = "";
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (!tag || tags.includes(tag)) return;
    setTags([...tags, tag]);
    const usedColors = Object.values(colors);
    const nextColor = DEFAULT_COLORS.find((c) => !usedColors.includes(c)) || DEFAULT_COLORS[tags.length % DEFAULT_COLORS.length];
    setColors({ ...colors, [tag]: nextColor });
    setNewTag("");
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
    const newColors = { ...colors };
    delete newColors[tag];
    setColors(newColors);
  };

  const updateColor = (tag: string, color: string) => {
    setColors({ ...colors, [tag]: color });
  };

  const cssDirty = css !== cssOriginal;

  return (
    <>
      <header className="main-header">
        <h1>Platform Settings</h1>
      </header>
      <div className="main-body">
        {/* Editor Stylesheet */}
        <div className="card" style={{ maxWidth: 800 }}>
          <h2 style={{ fontSize: 16, marginBottom: 4 }}>Editor Stylesheet</h2>
          <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 12 }}>
            Custom CSS applied to the WYSIWYG editor. Classes defined here can be used via the Style dropdown or directly in HTML source.
            Selectors are automatically scoped to the editor content area.
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <button
              className="btn"
              onClick={() => fileInputRef.current?.click()}
              style={{ fontSize: 13 }}
            >
              Import CSS file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".css,text/css"
              onChange={handleCssImport}
              style={{ display: "none" }}
            />
            {css && (
              <button
                className="btn"
                onClick={() => {
                  const blob = new Blob([css], { type: "text/css" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "editor-styles.css";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{ fontSize: 13 }}
              >
                Export
              </button>
            )}
            {cssDirty && (
              <span style={{ fontSize: 12, color: "var(--warning)", marginLeft: 4 }}>
                Unsaved changes
              </span>
            )}
          </div>

          {cssLoaded && (
            <textarea
              className="input"
              value={css}
              onChange={(e) => setCss(e.target.value)}
              placeholder={`/* Custom editor styles */\n\n.note {\n  background: #eff6ff;\n  border-left: 4px solid #3b82f6;\n  padding: 12px 16px;\n}\n\n.caption {\n  font-size: 0.875em;\n  color: #6b7280;\n  font-style: italic;\n}`}
              spellCheck={false}
              style={{
                width: "100%",
                minHeight: 300,
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                fontSize: 13,
                lineHeight: 1.5,
                padding: 12,
                borderRadius: 6,
                resize: "vertical",
                tabSize: 2,
                whiteSpace: "pre",
                overflowWrap: "normal",
                overflowX: "auto",
                boxSizing: "border-box",
              }}
            />
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
            <button
              onClick={saveCss}
              disabled={cssSaving || !cssDirty}
              className="btn btn-primary"
            >
              {cssSaving ? "Saving..." : "Save Stylesheet"}
            </button>
            {cssMessage && (
              <span style={{ fontSize: 13, color: "var(--success)" }}>{cssMessage}</span>
            )}
          </div>
        </div>

        {/* Conditional Content Tags */}
        <div className="card" style={{ maxWidth: 600, marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 16 }}>Conditional Content Tags</h2>
          <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 12 }}>
            Define the available condition tags and their colors. Colors help distinguish conditions at a glance in the editor.
          </p>

          {loaded && tags.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {tags.map((tag) => (
                <div key={tag} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="color"
                    value={colors[tag] || "#f59e0b"}
                    onChange={(e) => updateColor(tag, e.target.value)}
                    style={{
                      width: 28, height: 28, padding: 0,
                      border: "1px solid var(--border)", borderRadius: 4,
                      cursor: "pointer", background: "none",
                    }}
                    title={`Color for ${tag}`}
                  />
                  <span
                    style={{
                      flex: 1, fontSize: 14, padding: "4px 8px", borderRadius: 4,
                      background: hexToRgba(colors[tag] || "#f59e0b", 0.12),
                      borderLeft: `3px solid ${colors[tag] || "#f59e0b"}`,
                    }}
                  >
                    {tag}
                  </span>
                  <button
                    onClick={() => removeTag(tag)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--fg-muted)", fontSize: 16, padding: "2px 6px", borderRadius: 3,
                    }}
                    title={`Remove ${tag}`}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="input"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTag(); }}
              placeholder="New tag name..."
              style={{ flex: 1 }}
            />
            <button onClick={addTag} className="btn" disabled={!newTag.trim()}>
              Add
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
            <button onClick={saveConditions} disabled={saving} className="btn btn-primary">
              {saving ? "Saving..." : "Save"}
            </button>
            {message && (
              <span style={{ fontSize: 13, color: "var(--success)" }}>{message}</span>
            )}
          </div>
        </div>

        {/* GitHub Integration */}
        <div className="card" style={{ maxWidth: 600, marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 16 }}>GitHub Integration</h2>
          <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 8 }}>
            Configure via environment variables:
          </p>
          <ul style={{ fontSize: 14, paddingLeft: 20, lineHeight: 2 }}>
            <li><code style={{ background: "var(--bg-tertiary)", padding: "1px 4px", borderRadius: 3 }}>GITHUB_TOKEN</code> — Personal access token with repo scope</li>
            <li><code style={{ background: "var(--bg-tertiary)", padding: "1px 4px", borderRadius: 3 }}>GITHUB_REPO</code> — Repository in owner/repo format</li>
            <li><code style={{ background: "var(--bg-tertiary)", padding: "1px 4px", borderRadius: 3 }}>GITHUB_DEFAULT_BRANCH</code> — Default branch (defaults to main)</li>
          </ul>
        </div>
      </div>
    </>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(245, 158, 11, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
