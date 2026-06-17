"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import { useTheme } from "@/components/ThemeProvider";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import Icon from "@/components/Icon";
import type { User } from "@/lib/types";

const DEFAULT_IDENTITY = "nolwenn.marjou@beqom.com";

// Editor body fonts — per the Faro Design System, exactly two choices:
// a clean readable sans (default) and a literary serif. Other families
// (Bricolage, Lora, DM Sans, DM Mono) are reserved for chrome/display.
const EDITOR_FONTS = [
  {
    value: "source-sans",
    label: "Source Sans 3",
    description: "Clean technical sans — the workhorse default",
    preview: "var(--font-editor-sans)",
  },
  {
    value: "spectral",
    label: "Spectral",
    description: "Literary serif — designed for long-form on-screen",
    preview: "var(--font-editor-serif)",
  },
];

export default function UserSettingsPage() {
  const { theme, setTheme } = useTheme();
  const [autosaveInterval, setAutosaveInterval] = useState(120);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [editorFont, setEditorFont] = useState("source-sans");
  const [message, setMessage] = useState<string | null>(null);

  // Identity. Under OAuth (`authConfigured`) this is the real session and is
  // read-only here (shown with a Sign out button). In dev it's a switchable
  // stand-in; CurrentUserProvider owns persistence + cross-tab sync and we
  // mirror its value into local state so the <select> stays controlled.
  const { setIdentity, authConfigured, user: currentUser } = useCurrentUser();
  const [identity, setIdentityState] = useState<string>(DEFAULT_IDENTITY);
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("cms-autosave-interval");
    if (saved) setAutosaveInterval(Number(saved));
    const ws = localStorage.getItem("cms-show-whitespace");
    if (ws === "true") setShowWhitespace(true);
    const font = localStorage.getItem("cms-editor-font");
    if (font) setEditorFont(font);

    // Identity defaults to nolwenn for dev; load any prior selection.
    const id = localStorage.getItem("cms-current-user");
    if (id) setIdentityState(id);
    else localStorage.setItem("cms-current-user", DEFAULT_IDENTITY);

    // Pull the user list so the picker offers everyone Platform Settings has
    // configured. /api/users returns the seeded defaults if the file is empty.
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d: { users?: User[] }) => setUsers(d.users || []))
      .catch(() => setUsers([]));
  }, []);

  const handleIdentityChange = (email: string) => {
    setIdentityState(email);
    setIdentity(email); // persists + broadcasts so sidebar/dashboard re-render
    flash(`Identity set to ${email}`);
  };

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
    // Apply immediately to any open editor via CSS variable. The fallback
    // chain inside each token (`--font-editor-sans` / `--font-editor-serif`)
    // already includes system-font fallbacks.
    const fontCss = EDITOR_FONTS.find((f) => f.value === font)?.preview || "var(--font-editor-sans)";
    document.documentElement.style.setProperty("--font-editor", fontCss);
    flash("Editor font updated");
  };

  return (
    <>
      <header className="main-header">
        <h1>User Settings</h1>
      </header>
      <div className="main-body">
        {/* Identity */}
        <div className="card" style={{ maxWidth: 600, marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 4 }}>Identity</h2>
          {authConfigured ? (
            <>
              <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 12 }}>
                Signed in via GitHub.
              </p>
              <p style={{ fontSize: 14, marginBottom: 12 }}>
                {currentUser?.name ? `${currentUser.name} — ` : ""}
                {currentUser?.email}
                {currentUser?.role ? ` · ${currentUser.role}` : ""}
              </p>
              <button className="btn btn-sm" onClick={() => signOut()}>
                <Icon name="sign-out" size={14} />
                Sign out
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 12 }}>
                Stand-in for &ldquo;currently logged in user&rdquo; during the dev phase.
                Used as the sender on review requests. Replaced by GitHub sign-in once
                OAuth is configured.
              </p>
              <select
                className="input"
                value={identity}
                onChange={(e) => handleIdentityChange(e.target.value)}
                style={{ width: "100%", maxWidth: 360, fontSize: 14 }}
              >
                {users.length === 0 && (
                  <option value={DEFAULT_IDENTITY}>{DEFAULT_IDENTITY}</option>
                )}
                {users.map((u) => (
                  <option key={u.email} value={u.email}>
                    {u.name ? `${u.name} — ${u.email}` : u.email} · {u.role}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

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
                  <Icon name={opt.icon} size={14} />
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
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{f.label}</div>
                      <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                        {f.description}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        fontFamily: f.preview,
                        color: "var(--fg-muted)",
                        marginTop: 4,
                        lineHeight: 1.5,
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
