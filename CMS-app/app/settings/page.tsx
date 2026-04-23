"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/components/ThemeProvider";

const EDITOR_FONTS = [
  { value: "dm-sans", label: "DM Sans", preview: "var(--font-dm-sans), sans-serif" },
  { value: "lora", label: "Lora", preview: "var(--font-lora), serif" },
  { value: "cormorant", label: "Cormorant Garamond", preview: "var(--font-cormorant), serif" },
];

export default function UserSettingsPage() {
  const { theme, setTheme } = useTheme();
  const [autosaveInterval, setAutosaveInterval] = useState(120);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [editorFont, setEditorFont] = useState("dm-sans");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("cms-autosave-interval");
    if (saved) setAutosaveInterval(Number(saved));
    const ws = localStorage.getItem("cms-show-whitespace");
    if (ws === "true") setShowWhitespace(true);
    const font = localStorage.getItem("cms-editor-font");
    if (font) setEditorFont(font);
  }, []);

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 2000);
  };

  const handleAutosaveChange = (seconds: number) => {
    setAutosaveInterval(seconds);
    localStorage.setItem("cms-autosave-interval", String(seconds));
    flash("Autosave interval updated");
  };

  const handleWhitespaceChange = (enabled: boolean) => {
    setShowWhitespace(enabled);
    localStorage.setItem("cms-show-whitespace", String(enabled));
    flash("Whitespace display updated");
  };

  const handleEditorFontChange = (font: string) => {
    setEditorFont(font);
    localStorage.setItem("cms-editor-font", font);
    // Apply immediately to any open editor via CSS variable
    const fontCss = EDITOR_FONTS.find((f) => f.value === font)?.preview || "var(--font-dm-sans), sans-serif";
    document.documentElement.style.setProperty("--font-editor", fontCss);
    flash("Editor font updated");
  };

  return (
    <>
      <header className="main-header">
        <h1>User Settings</h1>
      </header>
      <div className="main-body">
        <div className="card" style={{ maxWidth: 600 }}>
          <h2 style={{ fontSize: 16, marginBottom: 16 }}>Appearance</h2>

          {/* Theme */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Theme</h3>
            <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 8 }}>
              Choose between light and dark mode, or follow your system preference.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              {([
                { value: "light", label: "Light", icon: "sun" },
                { value: "dark", label: "Dark", icon: "moon" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setTheme(opt.value); flash("Theme updated"); }}
                  className="btn btn-sm"
                  style={{
                    background: theme === opt.value ? "var(--accent)" : "var(--bg)",
                    color: theme === opt.value ? "#fff" : "var(--fg)",
                    borderColor: theme === opt.value ? "var(--accent)" : "var(--border)",
                  }}
                >
                  {opt.icon === "sun" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" />
                      <line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  )}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <h2 style={{ fontSize: 16, marginBottom: 16 }}>Editor Preferences</h2>

          {/* Autosave */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Autosave</h3>
            <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 8 }}>
              Articles are automatically saved at the chosen interval while editing.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                className="input"
                value={autosaveInterval}
                onChange={(e) => handleAutosaveChange(Number(e.target.value))}
                style={{ width: "auto" }}
              >
                <option value={0}>Disabled</option>
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
                <option value={300}>5 minutes</option>
                <option value={600}>10 minutes</option>
              </select>
              {autosaveInterval > 0 && (
                <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>
                  Currently: every {autosaveInterval >= 60 ? `${autosaveInterval / 60} min` : `${autosaveInterval}s`}
                </span>
              )}
            </div>
          </div>

          {/* Editor font */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Editor font</h3>
            <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 8 }}>
              Choose the typeface used for article content in the WYSIWYG editor.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {EDITOR_FONTS.map((f) => (
                <label
                  key={f.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: `2px solid ${editorFont === f.value ? "var(--accent)" : "var(--border)"}`,
                    background: editorFont === f.value ? "var(--accent-light)" : "var(--bg)",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <input
                    type="radio"
                    name="editor-font"
                    value={f.value}
                    checked={editorFont === f.value}
                    onChange={() => handleEditorFontChange(f.value)}
                    style={{ width: 16, height: 16, cursor: "pointer" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{f.label}</div>
                    <div
                      style={{
                        fontSize: 15,
                        fontFamily: f.preview,
                        color: "var(--fg-muted)",
                        marginTop: 2,
                      }}
                    >
                      The quick brown fox jumps over the lazy dog
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Display whitespace */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Display whitespace</h3>
            <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 8 }}>
              Show invisible characters (spaces, line breaks) in the editor by default. Can also be toggled per session from the toolbar.
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showWhitespace}
                onChange={(e) => handleWhitespaceChange(e.target.checked)}
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
              <span style={{ fontSize: 14 }}>Show whitespace characters</span>
            </label>
          </div>

          {message && (
            <p style={{ fontSize: 13, color: "var(--success)", marginTop: 16 }}>{message}</p>
          )}
        </div>
      </div>
    </>
  );
}
