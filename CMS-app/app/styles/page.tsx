"use client";

import { useEffect, useState, useCallback } from "react";
import type { ContentStyle } from "@/lib/types";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useCurrentProject } from "@/components/CurrentProjectProvider";
import TechWriterBlocked from "@/components/TechWriterBlocked";

type Scope = "shared" | "project";
type ClassScopes = Record<string, "shared" | "project">;
type ElementTag = ContentStyle["element"];
const ELEMENTS: ElementTag[] = ["p", "span", "div"];

export default function StylesPage() {
  const { role, loaded: userLoaded } = useCurrentUser();
  const { project, projects } = useCurrentProject();
  const projectLabel =
    projects.find((p) => p.slug === project)?.name || project || "this project";

  const [scope, setScope] = useState<Scope>("shared");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newClass, setNewClass] = useState("");
  const [newElement, setNewElement] = useState<ElementTag>("span");

  // Shared mode: the shared style list. Project mode: shared baseline (by class,
  // read-only) + a sparse overlay of class→style this project overrides/adds.
  const [styles, setStyles] = useState<ContentStyle[]>([]);
  const [sharedByClass, setSharedByClass] = useState<Record<string, ContentStyle>>({});
  const [overlay, setOverlay] = useState<Record<string, ContentStyle>>({});

  const flash = (m: string) => { setMessage(m); setTimeout(() => setMessage(null), 2000); };

  const loadData = useCallback(async (s: Scope) => {
    setLoading(true);
    try {
      if (s === "shared") {
        const d = await fetch("/api/styles?scope=shared").then((r) => r.json());
        setStyles(d.styles || []);
      } else {
        const [merged, shared] = await Promise.all([
          fetch("/api/styles").then((r) => r.json()) as Promise<{ styles: ContentStyle[]; scopes: ClassScopes }>,
          fetch("/api/styles?scope=shared").then((r) => r.json()) as Promise<{ styles: ContentStyle[] }>,
        ]);
        const sb: Record<string, ContentStyle> = {};
        for (const st of shared.styles || []) sb[st.class] = st;
        setSharedByClass(sb);
        const ov: Record<string, ContentStyle> = {};
        for (const st of merged.styles || []) {
          if (merged.scopes?.[st.class] === "project") ov[st.class] = st;
        }
        setOverlay(ov);
      }
    } catch {
      setStyles([]); setSharedByClass({}); setOverlay({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(scope); }, [scope, loadData]);

  // ── Shared mode ──
  const saveShared = async (updated: ContentStyle[]) => {
    setSaving(true);
    try {
      const res = await fetch("/api/styles?scope=shared", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styles: updated }),
      });
      if (res.ok) { setStyles(updated); flash("Saved"); } else flash("Failed to save");
    } catch { flash("Failed to save"); } finally { setSaving(false); }
  };
  const addShared = () => {
    const name = newName.trim(), cls = newClass.trim();
    if (!name || !cls || styles.some((s) => s.class === cls)) return;
    saveShared([...styles, { name, class: cls, element: newElement }]);
    setNewName(""); setNewClass(""); setNewElement("span");
  };
  const updateShared = (i: number, field: keyof ContentStyle, value: string) => {
    const updated = [...styles];
    updated[i] = { ...updated[i], [field]: value } as ContentStyle;
    setStyles(updated);
  };
  const deleteShared = (i: number) => {
    if (!confirm(`Delete style "${styles[i].name}"? This removes it for all projects.`)) return;
    saveShared(styles.filter((_, idx) => idx !== i));
  };

  // ── Project mode ──
  const setOv = (cls: string, style: ContentStyle) => setOverlay((prev) => ({ ...prev, [cls]: style }));
  const overrideClass = (cls: string) => setOv(cls, { ...sharedByClass[cls] });
  const dropOverride = (cls: string) =>
    setOverlay((prev) => { const n = { ...prev }; delete n[cls]; return n; });
  const updateOv = (cls: string, field: "name" | "element", value: string) =>
    setOverlay((prev) => ({ ...prev, [cls]: { ...prev[cls], [field]: value } as ContentStyle }));
  const addProject = () => {
    const name = newName.trim(), cls = newClass.trim();
    if (!name || !cls || cls in sharedByClass || cls in overlay) return;
    setOv(cls, { name, class: cls, element: newElement });
    setNewName(""); setNewClass(""); setNewElement("span");
  };
  const saveOverlay = async () => {
    setSaving(true);
    try {
      const arr = Object.values(overlay);
      const res = arr.length === 0
        ? await fetch("/api/styles?scope=project", { method: "DELETE" })
        : await fetch("/api/styles?scope=project", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ styles: arr }),
          });
      if (res.ok) { flash("Saved"); loadData("project"); } else flash("Failed to save");
    } catch { flash("Failed to save"); } finally { setSaving(false); }
  };

  const overrideCount = Object.keys(overlay).length;
  const projectClasses = [...new Set([...Object.keys(sharedByClass), ...Object.keys(overlay)])];

  if (userLoaded && role === "contributor") return <TechWriterBlocked title="Styles" />;

  const cell = { padding: "8px 12px", borderBottom: "1px solid var(--border)" } as const;
  const headCell = { textAlign: "left", padding: "8px 12px", borderBottom: "2px solid var(--border)", fontWeight: 600 } as const;

  const ScopeToggle = () => (
    <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      {(["shared", "project"] as Scope[]).map((s) => (
        <button key={s} onClick={() => setScope(s)} className="btn btn-sm"
          style={{ border: "none", borderRadius: 0, background: scope === s ? "var(--accent)" : "transparent", color: scope === s ? "#fff" : "var(--fg)" }}>
          {s === "shared" ? "Shared (all projects)" : projectLabel}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <header className="main-header">
        <h1>Styles</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {message && <span style={{ fontSize: 13, color: "var(--success)" }}>{message}</span>}
          <ScopeToggle />
          {scope === "shared" ? (
            <button onClick={() => saveShared(styles)} disabled={saving} className="btn btn-primary">{saving ? "Saving..." : "Save All"}</button>
          ) : (
            <button onClick={saveOverlay} disabled={saving} className="btn btn-primary">{saving ? "Saving..." : "Save Overrides"}</button>
          )}
        </div>
      </header>
      <div className="main-body">
        {loading && <p>Loading...</p>}

        {scope === "shared" ? (
          <>
            <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14 }}>
              Shared paragraph &amp; character styles — available in every project&apos;s editor. Changes here affect all projects.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={headCell}>Name</th>
                  <th style={{ ...headCell, width: "28%" }}>CSS class</th>
                  <th style={{ ...headCell, width: 110 }}>Element</th>
                  <th style={{ ...headCell, width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {styles.map((s, i) => (
                  <tr key={i}>
                    <td style={cell}><input className="input" value={s.name} onChange={(e) => updateShared(i, "name", e.target.value)} /></td>
                    <td style={cell}><input className="input" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }} value={s.class} onChange={(e) => updateShared(i, "class", e.target.value)} /></td>
                    <td style={cell}>
                      <select className="input" value={s.element} onChange={(e) => updateShared(i, "element", e.target.value)}>
                        {ELEMENTS.map((el) => <option key={el} value={el}>{el}</option>)}
                      </select>
                    </td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      <button onClick={() => deleteShared(i)} style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer", fontSize: 16 }}>x</button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ padding: "8px 12px" }}><input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Style name" /></td>
                  <td style={{ padding: "8px 12px" }}><input className="input" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }} value={newClass} onChange={(e) => setNewClass(e.target.value)} placeholder="css-class" /></td>
                  <td style={{ padding: "8px 12px" }}>
                    <select className="input" value={newElement} onChange={(e) => setNewElement(e.target.value as ElementTag)}>
                      {ELEMENTS.map((el) => <option key={el} value={el}>{el}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    <button onClick={addShared} className="btn btn-sm btn-primary" disabled={!newName.trim() || !newClass.trim()}>Add</button>
                  </td>
                </tr>
              </tbody>
            </table>
            {styles.length === 0 && !loading && (
              <div className="empty-state" style={{ marginTop: 32 }}><h3>No styles yet</h3><p>Add your first style above.</p></div>
            )}
          </>
        ) : (
          <>
            <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14 }}>
              Style overrides for <strong>{projectLabel}</strong> ({overrideCount}). Shared styles are read-only here; override one to change its name/element for this project, or add project-only styles. Other projects are unaffected.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={headCell}>Name</th>
                  <th style={{ ...headCell, width: "24%" }}>CSS class</th>
                  <th style={{ ...headCell, width: 90 }}>Element</th>
                  <th style={{ ...headCell, width: 100 }}>Scope</th>
                  <th style={{ ...headCell, width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {projectClasses.map((cls) => {
                  const inOverlay = overlay[cls] !== undefined;
                  const isProjectOnly = !(cls in sharedByClass);
                  const st = inOverlay ? overlay[cls] : sharedByClass[cls];
                  return (
                    <tr key={cls}>
                      <td style={cell}><input className="input" value={st.name} disabled={!inOverlay} onChange={(e) => updateOv(cls, "name", e.target.value)} /></td>
                      <td style={{ ...cell, fontFamily: "var(--font-mono)", fontSize: 13 }}>{cls}</td>
                      <td style={cell}>
                        <select className="input" value={st.element} disabled={!inOverlay} onChange={(e) => updateOv(cls, "element", e.target.value)}>
                          {ELEMENTS.map((el) => <option key={el} value={el}>{el}</option>)}
                        </select>
                      </td>
                      <td style={cell}>
                        <span className={inOverlay ? "badge badge-accent" : "badge"} title={inOverlay ? `Specific to ${projectLabel}` : "Shared"}>
                          {inOverlay ? projectLabel : "Shared"}
                        </span>
                      </td>
                      <td style={{ ...cell, textAlign: "center" }}>
                        {inOverlay ? (
                          <button className="btn btn-sm" onClick={() => dropOverride(cls)}>{isProjectOnly ? "Remove" : "Revert"}</button>
                        ) : (
                          <button className="btn btn-sm" onClick={() => overrideClass(cls)}>Override</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ padding: "8px 12px" }}><input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Style name" /></td>
                  <td style={{ padding: "8px 12px" }}><input className="input" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }} value={newClass} onChange={(e) => setNewClass(e.target.value)} placeholder="css-class" /></td>
                  <td style={{ padding: "8px 12px" }}>
                    <select className="input" value={newElement} onChange={(e) => setNewElement(e.target.value as ElementTag)}>
                      {ELEMENTS.map((el) => <option key={el} value={el}>{el}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "8px 12px" }} />
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    <button onClick={addProject} className="btn btn-sm btn-primary" disabled={!newName.trim() || !newClass.trim()}>Add</button>
                  </td>
                </tr>
              </tbody>
            </table>
            {projectClasses.length === 0 && !loading && (
              <div className="empty-state" style={{ marginTop: 32 }}><h3>No styles yet</h3><p>Add shared styles first, then override them per project.</p></div>
            )}
          </>
        )}
      </div>
    </>
  );
}
