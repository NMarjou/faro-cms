"use client";

import { useState, useEffect, useRef } from "react";
import type { ConditionsConfig, Project, User, UserRole } from "@/lib/types";
import Icon from "@/components/Icon";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useCurrentProject } from "@/components/CurrentProjectProvider";
import TechWriterBlocked from "@/components/TechWriterBlocked";

const DEFAULT_COLORS = [
  "#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
];

export default function PlatformSettingsPage() {
  const { role, loaded: userLoaded } = useCurrentUser();
  const { project, projects: allProjects } = useCurrentProject();
  const projectLabel =
    allProjects.find((p) => p.slug === project)?.name || project || "this project";

  // Conditions: shared-mode edits tags/colors directly; project mode keeps a
  // sparse overlay (project-only tags + per-tag color overrides) over a shared
  // baseline. condScope switches between the two.
  const [condScope, setCondScope] = useState<"shared" | "project">("shared");
  const [tags, setTags] = useState<string[]>([]);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [sharedCondTags, setSharedCondTags] = useState<string[]>([]);
  const [sharedCondColors, setSharedCondColors] = useState<Record<string, string>>({});
  const [ovTags, setOvTags] = useState<string[]>([]);
  const [ovColors, setOvColors] = useState<Record<string, string>>({});
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

  // Users & roles state
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersSaving, setUsersSaving] = useState(false);
  const [usersMessage, setUsersMessage] = useState<string | null>(null);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("contributor");

  // Projects state
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [projBusy, setProjBusy] = useState(false);
  const [projMsg, setProjMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects?: Project[] }) => setProjects(d.projects || []))
      .catch(() => {});
  }, []);

  const refreshProjects = () =>
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects?: Project[] }) => setProjects(d.projects || []))
      .catch(() => {});

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    setProjBusy(true);
    setProjMsg(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to create project");
      setNewProjectName("");
      await refreshProjects();
      setProjMsg(`Created “${name}”. Switch to it from the sidebar.`);
    } catch (e) {
      setProjMsg(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setProjBusy(false);
    }
  };

  const renameProject = async (slug: string, current: string) => {
    const name = window.prompt("Rename project", current)?.trim();
    if (!name || name === current) return;
    setProjMsg(null);
    const res = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, name }),
    });
    if (res.ok) await refreshProjects();
    else setProjMsg((await res.json().catch(() => ({}))).error || "Rename failed");
  };

  const deleteProject = async (slug: string, name: string) => {
    if (!window.confirm(`Remove project “${name}” from the list? Its files are left in place.`)) return;
    setProjMsg(null);
    const res = await fetch("/api/projects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    if (res.ok) await refreshProjects();
    else setProjMsg((await res.json().catch(() => ({}))).error || "Delete failed");
  };

  useEffect(() => {
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

    // Load users & roles
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => {
        setUsers(d.users || []);
        setUsersLoaded(true);
      })
      .catch(() => setUsersLoaded(true));
  }, []);

  // Load conditions for the active scope. Shared → editable tags/colors.
  // Project → shared baseline (read-only) + this project's overlay.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (condScope === "shared") {
        const d = await fetch("/api/conditions?scope=shared").then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (cancelled) return;
        setTags(d?.tags || []);
        setColors(d?.colors || {});
      } else {
        const [merged, shared] = await Promise.all([
          fetch("/api/conditions").then((r) => r.json()).catch(() => ({ tags: [], colors: {}, scopes: {} })),
          fetch("/api/conditions?scope=shared").then((r) => r.json()).catch(() => ({ tags: [], colors: {} })),
        ]);
        if (cancelled) return;
        const st: string[] = shared.tags || [];
        setSharedCondTags(st);
        setSharedCondColors(shared.colors || {});
        // Overlay = project-only tags + tags whose color the project overrides.
        const scopes: Record<string, "shared" | "project"> = merged.scopes || {};
        const projTags = (merged.tags || []).filter((t: string) => !st.includes(t));
        const projColors: Record<string, string> = {};
        for (const t of merged.tags || []) {
          if (scopes[t] === "project") projColors[t] = (merged.colors || {})[t];
        }
        setOvTags(projTags);
        setOvColors(projColors);
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [condScope]);

  const flashUsers = (msg: string) => {
    setUsersMessage(msg);
    setTimeout(() => setUsersMessage(null), 2000);
  };

  const persistUsers = async (next: User[], successMessage: string) => {
    setUsersSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users: next, message: successMessage }),
      });
      if (!res.ok) throw new Error("save failed");
      setUsers(next);
      flashUsers(successMessage);
    } catch {
      flashUsers("Failed to save");
    } finally {
      setUsersSaving(false);
    }
  };

  const addUser = () => {
    const email = newUserEmail.trim().toLowerCase();
    const name = newUserName.trim();
    if (!email) return;
    if (users.some((u) => u.email.toLowerCase() === email)) {
      flashUsers("User with that email already exists");
      return;
    }
    const next: User[] = [...users, { email, role: newUserRole, ...(name ? { name } : {}) }];
    setNewUserEmail("");
    setNewUserName("");
    setNewUserRole("contributor");
    persistUsers(next, `Add user ${email}`);
  };

  const updateUserRole = (email: string, role: UserRole) => {
    const next = users.map((u) => (u.email === email ? { ...u, role } : u));
    persistUsers(next, `Update role for ${email}`);
  };

  const removeUser = (email: string) => {
    const next = users.filter((u) => u.email !== email);
    persistUsers(next, `Remove user ${email}`);
  };

  const flashCond = (m: string) => { setMessage(m); setTimeout(() => setMessage(null), 2000); };

  const saveConditions = async () => {
    setSaving(true);
    try {
      let res: Response;
      if (condScope === "project") {
        const empty = ovTags.length === 0 && Object.keys(ovColors).length === 0;
        res = empty
          ? await fetch("/api/conditions?scope=project", { method: "DELETE" })
          : await fetch("/api/conditions?scope=project", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tags: ovTags, colors: ovColors } as ConditionsConfig),
            });
      } else {
        res = await fetch("/api/conditions?scope=shared", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags, colors } as ConditionsConfig),
        });
      }
      flashCond(res.ok ? "Saved" : "Failed to save");
    } catch {
      flashCond("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // ── Project-mode condition overlay ops ──
  const setProjColor = (tag: string, color: string) => setOvColors((prev) => ({ ...prev, [tag]: color }));
  const revertProjColor = (tag: string) =>
    setOvColors((prev) => { const n = { ...prev }; delete n[tag]; return n; });
  const addProjTag = () => {
    const tag = newTag.trim();
    if (!tag || sharedCondTags.includes(tag) || ovTags.includes(tag)) return;
    const used = { ...sharedCondColors, ...ovColors };
    const nextColor = DEFAULT_COLORS.find((c) => !Object.values(used).includes(c)) || DEFAULT_COLORS[0];
    setOvTags((prev) => [...prev, tag]);
    setProjColor(tag, nextColor);
    setNewTag("");
  };
  const removeProjTag = (tag: string) => {
    setOvTags((prev) => prev.filter((t) => t !== tag));
    revertProjColor(tag);
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

  if (userLoaded && role === "contributor") {
    return <TechWriterBlocked title="Platform Settings" />;
  }

  return (
    <>
      <header className="main-header">
        <h1>Platform Settings</h1>
      </header>
      <div className="main-body">
        {/* Projects */}
        <div className="card" style={{ maxWidth: 600, marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 4 }}>Projects</h2>
          <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 12 }}>
            Each project has its own table of contents and articles; images, snippets, styles
            and variables are shared across all projects. Switch the active project from the sidebar.
          </p>
          <div style={{ marginBottom: 12 }}>
            {projects.map((p) => (
              <div
                key={p.slug}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 0",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 500, fontSize: 14 }}>{p.name}</span>
                  <span style={{ fontSize: 12, color: "var(--fg-muted)", marginLeft: 8 }}>{p.slug}</span>
                  {p.default && <span className="badge" style={{ marginLeft: 8 }}>default</span>}
                </div>
                <button className="btn btn-sm" onClick={() => renameProject(p.slug, p.name)}>Rename</button>
                <button
                  className="btn btn-sm"
                  onClick={() => deleteProject(p.slug, p.name)}
                  disabled={p.default || projects.length <= 1}
                  title={p.default ? "Can't delete the default project" : "Remove from list"}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="input"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createProject(); }}
              placeholder="New project name"
              style={{ flex: 1, maxWidth: 280, fontSize: 14 }}
            />
            <button className="btn btn-primary btn-sm" onClick={createProject} disabled={projBusy || !newProjectName.trim()}>
              {projBusy ? "Creating…" : "Create project"}
            </button>
          </div>
          {projMsg && (
            <p style={{ fontSize: 13, color: "var(--fg-muted)", marginTop: 10 }}>{projMsg}</p>
          )}
        </div>

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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontSize: 16 }}>Conditional Content Tags</h2>
            <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
              {(["shared", "project"] as const).map((s) => (
                <button key={s} onClick={() => setCondScope(s)} className="btn btn-sm"
                  style={{ border: "none", borderRadius: 0, background: condScope === s ? "var(--accent)" : "transparent", color: condScope === s ? "#fff" : "var(--fg)" }}>
                  {s === "shared" ? "Shared (all projects)" : projectLabel}
                </button>
              ))}
            </div>
          </div>

          {condScope === "shared" ? (
            <>
              <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 12 }}>
                Shared condition tags + colors — available in every project. Changes here affect all projects.
              </p>
              {loaded && tags.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {tags.map((tag) => (
                    <div key={tag} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input type="color" value={colors[tag] || "#f59e0b"} onChange={(e) => updateColor(tag, e.target.value)}
                        style={{ width: 28, height: 28, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", background: "none" }} title={`Color for ${tag}`} />
                      <span style={{ flex: 1, fontSize: 14, padding: "4px 8px", borderRadius: 4, background: hexToRgba(colors[tag] || "#f59e0b", 0.12), borderLeft: `3px solid ${colors[tag] || "#f59e0b"}` }}>{tag}</span>
                      <button onClick={() => removeTag(tag)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--fg-muted)", fontSize: 16, padding: "2px 6px", borderRadius: 3 }} title={`Remove ${tag}`}>x</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="input" value={newTag} onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addTag(); }} placeholder="New tag name..." style={{ flex: 1 }} />
                <button onClick={addTag} className="btn" disabled={!newTag.trim()}>Add</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 12 }}>
                Condition overrides for <strong>{projectLabel}</strong>. Recolor a shared tag to give this project its own color, or add project-only tags. Other projects are unaffected.
              </p>
              {loaded && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {[...sharedCondTags, ...ovTags].map((tag) => {
                    const isProjectOnly = ovTags.includes(tag);
                    const overridden = tag in ovColors;
                    const inProject = isProjectOnly || overridden;
                    const color = ovColors[tag] ?? sharedCondColors[tag] ?? "#f59e0b";
                    return (
                      <div key={tag} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input type="color" value={color} onChange={(e) => setProjColor(tag, e.target.value)}
                          style={{ width: 28, height: 28, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", background: "none" }} title={`Color for ${tag}`} />
                        <span style={{ flex: 1, fontSize: 14, padding: "4px 8px", borderRadius: 4, background: hexToRgba(color, 0.12), borderLeft: `3px solid ${color}` }}>{tag}</span>
                        <span className={inProject ? "badge badge-accent" : "badge"} title={inProject ? `Specific to ${projectLabel}` : "Shared"}>
                          {inProject ? projectLabel : "Shared"}
                        </span>
                        {isProjectOnly ? (
                          <button onClick={() => removeProjTag(tag)} className="btn btn-sm" title="Remove project tag">Remove</button>
                        ) : overridden ? (
                          <button onClick={() => revertProjColor(tag)} className="btn btn-sm" title="Revert to shared color">Revert</button>
                        ) : (
                          <span style={{ width: 60 }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="input" value={newTag} onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addProjTag(); }} placeholder="Project-only tag name..." style={{ flex: 1 }} />
                <button onClick={addProjTag} className="btn" disabled={!newTag.trim()}>Add</button>
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
            <button onClick={saveConditions} disabled={saving} className="btn btn-primary">
              {saving ? "Saving..." : condScope === "project" ? "Save Overrides" : "Save"}
            </button>
            {message && <span style={{ fontSize: 13, color: "var(--success)" }}>{message}</span>}
          </div>
        </div>

        {/* Users & Roles */}
        <div className="card" style={{ maxWidth: 720, marginTop: 16 }}>
          <h2 style={{ fontSize: 16, marginBottom: 4 }}>Users & Roles</h2>
          <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 16 }}>
            Tech writers have full access to the CMS. Authors can create and edit their own articles
            but a tech writer must sign off before publishing. Contributors are subject-matter experts
            a tech writer can share specific articles with for review. Roles are not enforced during
            the current dev phase — auth wiring will pick this up later.
          </p>

          {usersLoaded && users.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 16 }}>
              {users.map((u, i) => (
                <div
                  key={u.email}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.6fr 1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 14px",
                    borderTop: i > 0 ? "1px solid var(--border-soft)" : undefined,
                    background: "var(--bg)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>
                      {u.name || u.email.split("@")[0]}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}>
                      {u.email}
                    </div>
                  </div>
                  <select
                    className="input"
                    value={u.role}
                    onChange={(e) => updateUserRole(u.email, e.target.value as UserRole)}
                    disabled={usersSaving}
                    style={{ width: "auto", fontSize: 13, padding: "4px 8px" }}
                  >
                    <option value="tech-writer">Tech writer</option>
                    <option value="author">Author</option>
                    <option value="contributor">Contributor</option>
                  </select>
                  <button
                    onClick={() => removeUser(u.email)}
                    disabled={usersSaving}
                    title="Remove user"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--fg-muted)",
                      padding: 4,
                      borderRadius: 4,
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add user */}
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr auto", gap: 8, alignItems: "center" }}>
            <input
              className="input"
              type="email"
              placeholder="email@beqom.com"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addUser(); }}
              style={{ fontSize: 13 }}
            />
            <input
              className="input"
              placeholder="Name (optional)"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addUser(); }}
              style={{ fontSize: 13 }}
            />
            <select
              className="input"
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value as UserRole)}
              style={{ fontSize: 13, padding: "6px 8px" }}
            >
              <option value="contributor">Contributor</option>
              <option value="author">Author</option>
              <option value="tech-writer">Tech writer</option>
            </select>
            <button
              onClick={addUser}
              disabled={!newUserEmail.trim() || usersSaving}
              className="btn btn-primary"
              style={{ fontSize: 13 }}
            >
              Add
            </button>
          </div>

          {usersMessage && (
            <p style={{ fontSize: 13, color: "var(--success)", marginTop: 12 }}>{usersMessage}</p>
          )}
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
