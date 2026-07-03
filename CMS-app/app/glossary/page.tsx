"use client";

import { useEffect, useState, useCallback } from "react";
import type { GlossaryTerm } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import { useCurrentProject } from "@/components/CurrentProjectProvider";

type Scope = "shared" | "project";
type TermScopes = Record<string, "shared" | "project">;

export default function GlossaryPage() {
  const { project, projects } = useCurrentProject();
  const projectLabel =
    projects.find((p) => p.slug === project)?.name || project || "this project";

  const [scope, setScope] = useState<Scope>("shared");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newTerm, setNewTerm] = useState("");
  const [newDef, setNewDef] = useState("");

  // Shared-mode: the shared term list (editable). Project-mode: shared baseline
  // (read-only) + a sparse overlay of term→definition this project overrides/adds.
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [sharedDefs, setSharedDefs] = useState<Record<string, string>>({});
  const [overlay, setOverlay] = useState<Record<string, string>>({});

  const flash = (m: string) => { setMessage(m); setTimeout(() => setMessage(null), 2000); };

  const loadData = useCallback(async (s: Scope) => {
    setLoading(true);
    try {
      if (s === "shared") {
        const d = await fetch("/api/glossary?scope=shared").then((r) => r.json());
        setTerms(d.terms || []);
      } else {
        const [merged, shared] = await Promise.all([
          fetch("/api/glossary").then((r) => r.json()) as Promise<{ terms: GlossaryTerm[]; scopes: TermScopes }>,
          fetch("/api/glossary?scope=shared").then((r) => r.json()) as Promise<{ terms: GlossaryTerm[] }>,
        ]);
        const sd: Record<string, string> = {};
        for (const t of shared.terms || []) sd[t.term] = t.definition;
        setSharedDefs(sd);
        const ov: Record<string, string> = {};
        for (const t of merged.terms || []) {
          if (merged.scopes?.[t.term] === "project") ov[t.term] = t.definition;
        }
        setOverlay(ov);
      }
    } catch {
      setTerms([]); setSharedDefs({}); setOverlay({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(scope); }, [scope, loadData]);

  // ── Shared mode ──
  const saveShared = async (updated: GlossaryTerm[]) => {
    setSaving(true);
    try {
      const res = await fetch("/api/glossary?scope=shared", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ glossary: { terms: updated } }),
      });
      if (res.ok) { setTerms(updated); flash("Saved"); } else flash("Failed to save");
    } catch { flash("Failed to save"); } finally { setSaving(false); }
  };
  const addSharedTerm = () => {
    if (!newTerm.trim() || !newDef.trim()) return;
    saveShared([...terms, { term: newTerm.trim(), definition: newDef.trim() }]);
    setNewTerm(""); setNewDef("");
  };
  const deleteSharedTerm = (index: number) => {
    if (!confirm(`Delete "${terms[index].term}"? This removes it for all projects.`)) return;
    saveShared(terms.filter((_, i) => i !== index));
  };
  const updateSharedTerm = (index: number, field: "term" | "definition", value: string) => {
    const updated = [...terms];
    updated[index] = { ...updated[index], [field]: value };
    setTerms(updated);
  };

  // ── Project mode ──
  const setOverlayDef = (term: string, def: string) =>
    setOverlay((prev) => ({ ...prev, [term]: def }));
  const overrideTerm = (term: string) => setOverlayDef(term, sharedDefs[term] ?? "");
  const dropOverride = (term: string) =>
    setOverlay((prev) => { const n = { ...prev }; delete n[term]; return n; });
  const addProjectTerm = () => {
    if (!newTerm.trim() || !newDef.trim()) return;
    setOverlayDef(newTerm.trim(), newDef.trim());
    setNewTerm(""); setNewDef("");
  };
  const saveOverlay = async () => {
    setSaving(true);
    try {
      const overlayTerms = Object.entries(overlay).map(([term, definition]) => ({ term, definition }));
      let res: Response;
      if (overlayTerms.length === 0) {
        res = await fetch("/api/glossary?scope=project", { method: "DELETE" });
      } else {
        res = await fetch("/api/glossary?scope=project", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ glossary: { terms: overlayTerms } }),
        });
      }
      if (res.ok) { flash("Saved"); loadData("project"); } else flash("Failed to save");
    } catch { flash("Failed to save"); } finally { setSaving(false); }
  };

  const overrideCount = Object.keys(overlay).length;
  const projectNames = [...new Set([...Object.keys(sharedDefs), ...Object.keys(overlay)])].sort((a, b) => a.localeCompare(b));

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

  const cell = { padding: "8px 12px", borderBottom: "1px solid var(--border)" } as const;
  const headCell = { textAlign: "left", padding: "8px 12px", borderBottom: "2px solid var(--border)", fontWeight: 600 } as const;

  return (
    <>
      <PageHeader title="Glossary">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {message && <span style={{ fontSize: 13, color: "var(--success)" }}>{message}</span>}
          <ScopeToggle />
          <button onClick={scope === "shared" ? () => saveShared(terms) : saveOverlay} disabled={saving} className="btn btn-primary">
            {saving ? "Saving..." : scope === "shared" ? "Save All" : "Save Overrides"}
          </button>
        </div>
      </PageHeader>
      <div className="main-body">
        {loading && <p>Loading...</p>}

        {scope === "shared" ? (
          <>
            <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14 }}>
              Shared glossary — available in every project. Changes here affect all projects.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ ...headCell, width: "30%" }}>Term</th>
                  <th style={headCell}>Definition</th>
                  <th style={{ ...headCell, width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {terms.map((t, i) => (
                  <tr key={i}>
                    <td style={cell}><input className="input" value={t.term} onChange={(e) => updateSharedTerm(i, "term", e.target.value)} /></td>
                    <td style={cell}><input className="input" value={t.definition} onChange={(e) => updateSharedTerm(i, "definition", e.target.value)} /></td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      <button onClick={() => deleteSharedTerm(i)} style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer", fontSize: 16 }}>x</button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ padding: "8px 12px" }}><input className="input" value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder="New term" /></td>
                  <td style={{ padding: "8px 12px" }}><input className="input" value={newDef} onChange={(e) => setNewDef(e.target.value)} placeholder="Definition" /></td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    <button onClick={addSharedTerm} className="btn btn-sm btn-primary" disabled={!newTerm.trim() || !newDef.trim()}>Add</button>
                  </td>
                </tr>
              </tbody>
            </table>
            {terms.length === 0 && !loading && (
              <div className="empty-state" style={{ marginTop: 32 }}><h3>No glossary terms yet</h3><p>Add your first term above.</p></div>
            )}
          </>
        ) : (
          <>
            <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14 }}>
              Glossary overrides for <strong>{projectLabel}</strong> ({overrideCount}). Shared definitions are read-only here; override one to give this project its own wording, or add project-only terms. Other projects are unaffected.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ ...headCell, width: "26%" }}>Term</th>
                  <th style={{ ...headCell, width: 100 }}>Scope</th>
                  <th style={headCell}>Definition</th>
                  <th style={{ ...headCell, width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {projectNames.map((term) => {
                  const inOverlay = overlay[term] !== undefined;
                  const isProjectOnly = !(term in sharedDefs);
                  const def = inOverlay ? overlay[term] : (sharedDefs[term] ?? "");
                  return (
                    <tr key={term}>
                      <td style={{ ...cell, fontFamily: "var(--font-mono)", fontSize: 13 }}>{term}</td>
                      <td style={cell}>
                        <span className={inOverlay ? "badge badge-accent" : "badge"} title={inOverlay ? `Specific to ${projectLabel}` : "Shared definition"}>
                          {inOverlay ? projectLabel : "Shared"}
                        </span>
                      </td>
                      <td style={cell}>
                        <input className="input" value={def} disabled={!inOverlay} onChange={(e) => setOverlayDef(term, e.target.value)} />
                      </td>
                      <td style={{ ...cell, textAlign: "center" }}>
                        {inOverlay ? (
                          <button className="btn btn-sm" onClick={() => dropOverride(term)}>{isProjectOnly ? "Remove" : "Revert"}</button>
                        ) : (
                          <button className="btn btn-sm" onClick={() => overrideTerm(term)}>Override</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ padding: "8px 12px" }}><input className="input" value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder="Project-only term" /></td>
                  <td style={{ padding: "8px 12px" }} />
                  <td style={{ padding: "8px 12px" }}><input className="input" value={newDef} onChange={(e) => setNewDef(e.target.value)} placeholder="Definition" /></td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    <button onClick={addProjectTerm} className="btn btn-sm btn-primary" disabled={!newTerm.trim() || !newDef.trim()}>Add</button>
                  </td>
                </tr>
              </tbody>
            </table>
            {projectNames.length === 0 && !loading && (
              <div className="empty-state" style={{ marginTop: 32 }}><h3>No glossary terms yet</h3><p>Add shared terms first, then override them per project.</p></div>
            )}
          </>
        )}
      </div>
    </>
  );
}
