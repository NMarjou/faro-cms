"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import dynamic from "next/dynamic";
import type { VariableSetsData } from "@/lib/types";
import { DragHandle } from "@/components/SortableList";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useCurrentProject } from "@/components/CurrentProjectProvider";
import TechWriterBlocked from "@/components/TechWriterBlocked";

const SortableList = dynamic(() => import("@/components/SortableList"), {
  ssr: false,
}) as typeof import("@/components/SortableList").default;

type Scope = "shared" | "project";
type VarScopes = Record<string, Record<string, "shared" | "project">>;
// Sparse project overlay: setSlug → { key → value }.
type Overlay = Record<string, Record<string, string>>;

export default function VariablesPage() {
  const { role, loaded } = useCurrentUser();
  const { project, projects } = useCurrentProject();
  const projectLabel =
    projects.find((p) => p.slug === project)?.name || project || "this project";

  const [scope, setScope] = useState<Scope>("shared");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Shared-mode state.
  const [data, setData] = useState<VariableSetsData>({ sets: [] });
  const [creatingSet, setCreatingSet] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const setInputRef = useRef<HTMLInputElement>(null);
  const [newVarKey, setNewVarKey] = useState<Record<string, string>>({});
  const [newVarValue, setNewVarValue] = useState<Record<string, string>>({});

  // Project-mode state: merged sets (for the key union + set names), the shared
  // baseline values, and the editable sparse overlay.
  const [mergedSets, setMergedSets] = useState<VariableSetsData>({ sets: [] });
  const [sharedVals, setSharedVals] = useState<Record<string, Record<string, string>>>({});
  const [overlay, setOverlay] = useState<Overlay>({});

  const flash = (m: string) => { setMessage(m); setTimeout(() => setMessage(null), 2000); };

  const loadData = useCallback(async (s: Scope) => {
    setLoading(true);
    try {
      if (s === "shared") {
        const d: VariableSetsData = await fetch("/api/variables?format=sets&scope=shared").then((r) => r.json());
        setData(d);
        setExpanded(new Set(d.sets.map((x) => x.slug)));
      } else {
        const [merged, shared] = await Promise.all([
          fetch("/api/variables?format=sets").then((r) => r.json()) as Promise<VariableSetsData & { scopes: VarScopes }>,
          fetch("/api/variables?format=sets&scope=shared").then((r) => r.json()) as Promise<VariableSetsData>,
        ]);
        setMergedSets({ sets: merged.sets });
        const sv: Record<string, Record<string, string>> = {};
        for (const set of shared.sets) sv[set.slug] = { ...set.variables };
        setSharedVals(sv);
        // Seed the overlay from the server's project-scoped keys.
        const ov: Overlay = {};
        for (const set of merged.sets) {
          for (const [k, v] of Object.entries(set.variables)) {
            if (merged.scopes?.[set.slug]?.[k] === "project") {
              (ov[set.slug] ??= {})[k] = v;
            }
          }
        }
        setOverlay(ov);
        setExpanded(new Set(merged.sets.map((x) => x.slug)));
      }
    } catch {
      setData({ sets: [] });
      setMergedSets({ sets: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(scope); }, [scope, loadData]);
  useEffect(() => { if (creatingSet && setInputRef.current) setInputRef.current.focus(); }, [creatingSet]);

  const generateSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const toggle = (slug: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  // ── Shared-mode persistence ──
  const saveShared = async (updated: VariableSetsData) => {
    setSaving(true);
    try {
      const res = await fetch("/api/variables?scope=shared", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (res.ok) { setData(updated); flash("Saved"); }
      else flash("Failed to save");
    } catch { flash("Failed to save"); } finally { setSaving(false); }
  };

  const createSet = () => {
    const name = newSetName.trim();
    if (!name) { setCreatingSet(false); return; }
    const slug = generateSlug(name);
    if (data.sets.some((s) => s.slug === slug)) { setCreatingSet(false); return; }
    setExpanded((prev) => new Set([...prev, slug]));
    saveShared({ sets: [...data.sets, { name, slug, variables: {} }] });
    setCreatingSet(false);
    setNewSetName("");
  };
  const deleteSet = (slug: string) => {
    const set = data.sets.find((s) => s.slug === slug);
    if (!set || !confirm(`Delete set "${set.name}" and all its variables?`)) return;
    saveShared({ sets: data.sets.filter((s) => s.slug !== slug) });
  };
  const renameSet = (slug: string) => {
    const set = data.sets.find((s) => s.slug === slug);
    if (!set) return;
    const newName = prompt("Rename set:", set.name);
    if (!newName?.trim()) return;
    saveShared({ sets: data.sets.map((s) => s.slug === slug ? { ...s, name: newName.trim() } : s) });
  };
  const addVariable = (setSlug: string) => {
    const key = (newVarKey[setSlug] || "").trim();
    const value = newVarValue[setSlug] || "";
    if (!key) return;
    saveShared({
      sets: data.sets.map((s) => s.slug === setSlug ? { ...s, variables: { ...s.variables, [key]: value } } : s),
    });
    setNewVarKey((prev) => ({ ...prev, [setSlug]: "" }));
    setNewVarValue((prev) => ({ ...prev, [setSlug]: "" }));
  };
  const updateVariable = (setSlug: string, key: string, value: string) => {
    setData((prev) => ({
      sets: prev.sets.map((s) => s.slug === setSlug ? { ...s, variables: { ...s.variables, [key]: value } } : s),
    }));
  };
  const deleteVariable = (setSlug: string, key: string) => {
    if (!confirm(`Delete variable "${key}"?`)) return;
    saveShared({
      sets: data.sets.map((s) => {
        if (s.slug !== setSlug) return s;
        const vars = { ...s.variables }; delete vars[key];
        return { ...s, variables: vars };
      }),
    });
  };
  const reorderVariables = (setSlug: string, newItems: { id: string }[]) => {
    setData((prev) => ({
      sets: prev.sets.map((s) => {
        if (s.slug !== setSlug) return s;
        const ordered: Record<string, string> = {};
        for (const item of newItems) if (item.id in s.variables) ordered[item.id] = s.variables[item.id];
        return { ...s, variables: ordered };
      }),
    }));
  };

  // ── Project-mode overlay ops ──
  const setOverlayVal = (slug: string, key: string, value: string) =>
    setOverlay((prev) => ({ ...prev, [slug]: { ...prev[slug], [key]: value } }));
  const overrideKey = (slug: string, key: string) =>
    setOverlayVal(slug, key, sharedVals[slug]?.[key] ?? "");
  const dropOverride = (slug: string, key: string) =>
    setOverlay((prev) => {
      const set = { ...prev[slug] }; delete set[key];
      const next = { ...prev };
      if (Object.keys(set).length) next[slug] = set; else delete next[slug];
      return next;
    });
  const addProjectVar = (slug: string) => {
    const key = (newVarKey[slug] || "").trim();
    if (!key) return;
    setOverlayVal(slug, key, newVarValue[slug] || "");
    setNewVarKey((prev) => ({ ...prev, [slug]: "" }));
    setNewVarValue((prev) => ({ ...prev, [slug]: "" }));
  };

  const saveOverlay = async () => {
    setSaving(true);
    try {
      const sets = mergedSets.sets
        .filter((s) => overlay[s.slug] && Object.keys(overlay[s.slug]).length)
        .map((s) => ({ name: s.name, slug: s.slug, variables: overlay[s.slug] }));
      let res: Response;
      if (sets.length === 0) {
        res = await fetch("/api/variables?scope=project", { method: "DELETE" });
      } else {
        res = await fetch("/api/variables?scope=project", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sets, message: `Update ${projectLabel} variable overrides` }),
        });
      }
      if (res.ok) { flash("Saved"); loadData("project"); } else flash("Failed to save");
    } catch { flash("Failed to save"); } finally { setSaving(false); }
  };

  const totalVars = data.sets.reduce((n, s) => n + Object.keys(s.variables).length, 0);
  const overrideCount = Object.values(overlay).reduce((n, m) => n + Object.keys(m).length, 0);

  if (loaded && role === "contributor") return <TechWriterBlocked title="Variables" />;

  const ScopeToggle = () => (
    <div className="segmented" style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      {(["shared", "project"] as Scope[]).map((s) => (
        <button
          key={s}
          onClick={() => setScope(s)}
          className="btn btn-sm"
          style={{
            border: "none", borderRadius: 0,
            background: scope === s ? "var(--accent)" : "transparent",
            color: scope === s ? "#fff" : "var(--fg)",
          }}
        >
          {s === "shared" ? "Shared (all projects)" : projectLabel}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader title="Variables">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {message && <span style={{ fontSize: 13, color: "var(--success)" }}>{message}</span>}
          <ScopeToggle />
          {scope === "shared" ? (
            <>
              <button className="btn" onClick={() => { setCreatingSet(true); setNewSetName(""); }}>New Set</button>
              <button onClick={() => saveShared(data)} disabled={saving} className="btn btn-primary">
                {saving ? "Saving..." : "Save All"}
              </button>
            </>
          ) : (
            <button onClick={saveOverlay} disabled={saving} className="btn btn-primary">
              {saving ? "Saving..." : "Save Overrides"}
            </button>
          )}
        </div>
      </PageHeader>
      <div className="main-body">
        {loading && <p>Loading...</p>}

        {scope === "shared" ? (
          <>
            <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14 }}>
              Shared variables — available in every project ({totalVars} total). Changes here affect all projects.
            </p>
            {data.sets.map((set) => {
              const isOpen = expanded.has(set.slug);
              const varEntries = Object.entries(set.variables);
              return (
                <div key={set.slug} className="card" style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isOpen ? 12 : 0 }}>
                    <button onClick={() => toggle(set.slug)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: 0, fontFamily: "inherit" }}>
                      <span style={{ fontSize: 12, transform: isOpen ? "rotate(90deg)" : "none" }}>&#9654;</span>
                      <h2 style={{ fontSize: 16, fontWeight: 600 }}>{set.name}</h2>
                      <span className="badge">{varEntries.length}</span>
                    </button>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-sm" onClick={() => renameSet(set.slug)}>Rename</button>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteSet(set.slug)}>Delete</button>
                    </div>
                  </div>
                  {isOpen && (
                    <>
                      {varEntries.length > 0 && (
                        <SortableList
                          items={varEntries.map(([k, v]) => ({ id: k, key: k, value: v }))}
                          onReorder={(items) => reorderVariables(set.slug, items)}
                          renderItem={(item, handleProps) => (
                            <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}>
                              <div style={{ padding: "6px 8px", display: "flex", alignItems: "center" }}>
                                <DragHandle ref={handleProps.ref} {...handleProps.listeners} />
                              </div>
                              <div style={{ padding: "6px 8px", fontFamily: "var(--font-mono)", fontSize: 13, minWidth: 150 }}>{item.key}</div>
                              <div style={{ padding: "6px 8px", flex: 1 }}>
                                <input className="input" value={item.value} onChange={(e) => updateVariable(set.slug, item.key, e.target.value)} />
                              </div>
                              <div style={{ padding: "6px 8px" }}>
                                <button onClick={() => deleteVariable(set.slug, item.key)} style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer", fontSize: 16 }}>x</button>
                              </div>
                            </div>
                          )}
                        />
                      )}
                      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", marginTop: 4 }}>
                        <input className="input" value={newVarKey[set.slug] || ""} onChange={(e) => setNewVarKey((p) => ({ ...p, [set.slug]: e.target.value }))} placeholder="variableName" style={{ fontFamily: "var(--font-mono)", fontSize: 13, maxWidth: 200 }} />
                        <input className="input" value={newVarValue[set.slug] || ""} onChange={(e) => setNewVarValue((p) => ({ ...p, [set.slug]: e.target.value }))} placeholder="Value" style={{ flex: 1 }} />
                        <button onClick={() => addVariable(set.slug)} className="btn btn-sm btn-primary" disabled={!(newVarKey[set.slug] || "").trim()}>Add</button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {creatingSet && (
              <div className="card" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <input ref={setInputRef} className="input" value={newSetName} onChange={(e) => setNewSetName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createSet(); if (e.key === "Escape") { setCreatingSet(false); setNewSetName(""); } }}
                  placeholder="Set name..." style={{ maxWidth: 300 }} />
                <button className="btn btn-sm btn-primary" onClick={createSet} disabled={!newSetName.trim()}>Create</button>
                <button className="btn btn-sm" onClick={() => { setCreatingSet(false); setNewSetName(""); }}>Cancel</button>
              </div>
            )}
            {data.sets.length === 0 && !loading && !creatingSet && (
              <div className="empty-state" style={{ marginTop: 32 }}>
                <h3>No variable sets yet</h3>
                <p>Create your first set to organize variables.</p>
              </div>
            )}
          </>
        ) : (
          <>
            <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14 }}>
              Overrides for <strong>{projectLabel}</strong> ({overrideCount}). Shared values are read-only here; override one to give this project its own value, or add project-only variables. Other projects are unaffected.
            </p>
            {mergedSets.sets.map((set) => {
              const isOpen = expanded.has(set.slug);
              const sharedKeys = Object.keys(sharedVals[set.slug] || {});
              const projectOnlyKeys = Object.keys(overlay[set.slug] || {}).filter((k) => !(k in (sharedVals[set.slug] || {})));
              const keys = [...sharedKeys, ...projectOnlyKeys];
              return (
                <div key={set.slug} className="card" style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isOpen ? 12 : 0 }}>
                    <button onClick={() => toggle(set.slug)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: 0, fontFamily: "inherit" }}>
                      <span style={{ fontSize: 12, transform: isOpen ? "rotate(90deg)" : "none" }}>&#9654;</span>
                      <h2 style={{ fontSize: 16, fontWeight: 600 }}>{set.name}</h2>
                      <span className="badge">{keys.length}</span>
                    </button>
                  </div>
                  {isOpen && (
                    <>
                      {keys.map((key) => {
                        const inOverlay = overlay[set.slug]?.[key] !== undefined;
                        const isProjectOnly = !(key in (sharedVals[set.slug] || {}));
                        const value = inOverlay ? overlay[set.slug][key] : (sharedVals[set.slug]?.[key] ?? "");
                        return (
                          <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, minWidth: 150 }}>{key}</div>
                            <span className={inOverlay ? "badge badge-accent" : "badge"} title={inOverlay ? `Specific to ${projectLabel}` : "Shared value"}>
                              {inOverlay ? projectLabel : "Shared"}
                            </span>
                            <input className="input" style={{ flex: 1 }} value={value} disabled={!inOverlay}
                              onChange={(e) => setOverlayVal(set.slug, key, e.target.value)} />
                            {inOverlay ? (
                              <button className="btn btn-sm" onClick={() => dropOverride(set.slug, key)}>
                                {isProjectOnly ? "Remove" : "Revert"}
                              </button>
                            ) : (
                              <button className="btn btn-sm" onClick={() => overrideKey(set.slug, key)}>Override</button>
                            )}
                          </div>
                        );
                      })}
                      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", marginTop: 4 }}>
                        <input className="input" value={newVarKey[set.slug] || ""} onChange={(e) => setNewVarKey((p) => ({ ...p, [set.slug]: e.target.value }))} placeholder="projectVariableName" style={{ fontFamily: "var(--font-mono)", fontSize: 13, maxWidth: 200 }} />
                        <input className="input" value={newVarValue[set.slug] || ""} onChange={(e) => setNewVarValue((p) => ({ ...p, [set.slug]: e.target.value }))} placeholder="Project-only value" style={{ flex: 1 }} />
                        <button onClick={() => addProjectVar(set.slug)} className="btn btn-sm btn-primary" disabled={!(newVarKey[set.slug] || "").trim()}>Add</button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {mergedSets.sets.length === 0 && !loading && (
              <div className="empty-state" style={{ marginTop: 32 }}>
                <h3>No variables yet</h3>
                <p>Add shared variables first, then override them per project.</p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
