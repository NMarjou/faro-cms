"use client";

import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import type { VariableSet, VariableSetsData } from "@/lib/types";
import { DragHandle } from "@/components/SortableList";

const SortableList = dynamic(() => import("@/components/SortableList"), { ssr: false });

export default function VariablesPage() {
  const [data, setData] = useState<VariableSetsData>({ sets: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Inline creation
  const [creatingSet, setCreatingSet] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const setInputRef = useRef<HTMLInputElement>(null);

  // Per-set new variable inputs
  const [newVarKey, setNewVarKey] = useState<Record<string, string>>({});
  const [newVarValue, setNewVarValue] = useState<Record<string, string>>({});

  const loadData = () => {
    fetch("/api/variables?format=sets")
      .then((r) => r.json())
      .then((d: VariableSetsData) => {
        setData(d);
        // Auto-expand all sets
        setExpanded(new Set(d.sets.map((s) => s.slug)));
      })
      .catch(() => setData({ sets: [] }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (creatingSet && setInputRef.current) setInputRef.current.focus(); }, [creatingSet]);

  const save = async (updated: VariableSetsData) => {
    setSaving(true);
    try {
      const res = await fetch("/api/variables", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        setData(updated);
        setMessage("Saved");
        setTimeout(() => setMessage(null), 2000);
      }
    } catch {
      setMessage("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const generateSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const toggle = (slug: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  // ── Set CRUD ──

  const createSet = () => {
    const name = newSetName.trim();
    if (!name) { setCreatingSet(false); return; }
    const slug = generateSlug(name);
    if (data.sets.some((s) => s.slug === slug)) { setCreatingSet(false); return; }
    const updated: VariableSetsData = {
      sets: [...data.sets, { name, slug, variables: {} }],
    };
    setExpanded((prev) => new Set([...prev, slug]));
    save(updated);
    setCreatingSet(false);
    setNewSetName("");
  };

  const deleteSet = (slug: string) => {
    const set = data.sets.find((s) => s.slug === slug);
    if (!set || !confirm(`Delete set "${set.name}" and all its variables?`)) return;
    save({ sets: data.sets.filter((s) => s.slug !== slug) });
  };

  const renameSet = (slug: string) => {
    const set = data.sets.find((s) => s.slug === slug);
    if (!set) return;
    const newName = prompt("Rename set:", set.name);
    if (!newName?.trim()) return;
    save({
      sets: data.sets.map((s) => s.slug === slug ? { ...s, name: newName.trim() } : s),
    });
  };

  // ── Variable CRUD within a set ──

  const addVariable = (setSlug: string) => {
    const key = (newVarKey[setSlug] || "").trim();
    const value = newVarValue[setSlug] || "";
    if (!key) return;
    const updated: VariableSetsData = {
      sets: data.sets.map((s) =>
        s.slug === setSlug ? { ...s, variables: { ...s.variables, [key]: value } } : s
      ),
    };
    save(updated);
    setNewVarKey((prev) => ({ ...prev, [setSlug]: "" }));
    setNewVarValue((prev) => ({ ...prev, [setSlug]: "" }));
  };

  const updateVariable = (setSlug: string, key: string, value: string) => {
    setData((prev) => ({
      sets: prev.sets.map((s) =>
        s.slug === setSlug ? { ...s, variables: { ...s.variables, [key]: value } } : s
      ),
    }));
  };

  const deleteVariable = (setSlug: string, key: string) => {
    if (!confirm(`Delete variable "${key}"?`)) return;
    const updated: VariableSetsData = {
      sets: data.sets.map((s) => {
        if (s.slug !== setSlug) return s;
        const vars = { ...s.variables };
        delete vars[key];
        return { ...s, variables: vars };
      }),
    };
    save(updated);
  };

  const reorderVariables = (setSlug: string, newItems: { id: string }[]) => {
    setData((prev) => ({
      sets: prev.sets.map((s) => {
        if (s.slug !== setSlug) return s;
        const ordered: Record<string, string> = {};
        for (const item of newItems) {
          if (item.id in s.variables) ordered[item.id] = s.variables[item.id];
        }
        return { ...s, variables: ordered };
      }),
    }));
  };

  const saveAll = () => save(data);

  // ── Total count ──
  const totalVars = data.sets.reduce((sum, s) => sum + Object.keys(s.variables).length, 0);

  return (
    <>
      <header className="main-header">
        <h1>Variables</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {message && <span style={{ fontSize: 13, color: "var(--success)" }}>{message}</span>}
          <button className="btn" onClick={() => { setCreatingSet(true); setNewSetName(""); }}>New Set</button>
          <button onClick={saveAll} disabled={saving} className="btn btn-primary">
            {saving ? "Saving..." : "Save All"}
          </button>
        </div>
      </header>
      <div className="main-body">
        {loading && <p>Loading...</p>}

        <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14 }}>
          Organize variables into sets. All variables are globally available in articles ({totalVars} total).
        </p>

        {data.sets.map((set) => {
          const isOpen = expanded.has(set.slug);
          const varEntries = Object.entries(set.variables);
          return (
            <div key={set.slug} className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isOpen ? 12 : 0 }}>
                <button onClick={() => toggle(set.slug)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: 0, fontFamily: "inherit" }}>
                  <span style={{ fontSize: 12, transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "none" }}>&#9654;</span>
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
                    <input
                      className="input"
                      value={newVarKey[set.slug] || ""}
                      onChange={(e) => setNewVarKey((prev) => ({ ...prev, [set.slug]: e.target.value }))}
                      placeholder="variableName"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 13, maxWidth: 200 }}
                    />
                    <input
                      className="input"
                      value={newVarValue[set.slug] || ""}
                      onChange={(e) => setNewVarValue((prev) => ({ ...prev, [set.slug]: e.target.value }))}
                      placeholder="Value"
                      style={{ flex: 1 }}
                    />
                    <button
                      onClick={() => addVariable(set.slug)}
                      className="btn btn-sm btn-primary"
                      disabled={!(newVarKey[set.slug] || "").trim()}
                    >
                      Add
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Inline set creation */}
        {creatingSet && (
          <div className="card" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              ref={setInputRef}
              className="input"
              value={newSetName}
              onChange={(e) => setNewSetName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createSet(); if (e.key === "Escape") { setCreatingSet(false); setNewSetName(""); } }}
              placeholder="Set name..."
              style={{ maxWidth: 300 }}
            />
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
      </div>
    </>
  );
}
