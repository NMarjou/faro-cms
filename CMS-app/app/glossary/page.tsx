"use client";

import { useEffect, useState } from "react";
import type { GlossaryTerm } from "@/lib/types";

export default function GlossaryPage() {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newTerm, setNewTerm] = useState("");
  const [newDef, setNewDef] = useState("");

  useEffect(() => {
    fetch("/api/glossary")
      .then((r) => r.json())
      .then((data) => setTerms(data.terms || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const save = async (updated: GlossaryTerm[]) => {
    setSaving(true);
    try {
      const res = await fetch("/api/glossary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ glossary: { terms: updated } }),
      });
      if (res.ok) {
        setTerms(updated);
        setMessage("Saved");
        setTimeout(() => setMessage(null), 2000);
      }
    } catch {
      setMessage("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const addTerm = () => {
    if (!newTerm.trim() || !newDef.trim()) return;
    save([...terms, { term: newTerm.trim(), definition: newDef.trim() }]);
    setNewTerm("");
    setNewDef("");
  };

  const deleteTerm = (index: number) => {
    if (!confirm(`Delete "${terms[index].term}"?`)) return;
    save(terms.filter((_, i) => i !== index));
  };

  const updateTerm = (index: number, field: "term" | "definition", value: string) => {
    const updated = [...terms];
    updated[index] = { ...updated[index], [field]: value };
    setTerms(updated);
  };

  return (
    <>
      <header className="main-header">
        <h1>Glossary</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {message && <span style={{ fontSize: 13, color: "var(--success)" }}>{message}</span>}
          <button onClick={() => save(terms)} disabled={saving} className="btn btn-primary">
            {saving ? "Saving..." : "Save All"}
          </button>
        </div>
      </header>
      <div className="main-body">
        <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14 }}>
          Glossary terms appear as tooltips when inserted in articles.
        </p>

        {loading && <p>Loading...</p>}

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "2px solid var(--border)", fontWeight: 600, width: "30%" }}>Term</th>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Definition</th>
              <th style={{ width: 60, padding: "8px 12px", borderBottom: "2px solid var(--border)" }} />
            </tr>
          </thead>
          <tbody>
            {terms
              .sort((a, b) => a.term.localeCompare(b.term))
              .map((t, i) => (
                <tr key={i}>
                  <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                    <input className="input" value={t.term} onChange={(e) => updateTerm(i, "term", e.target.value)} />
                  </td>
                  <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                    <input className="input" value={t.definition} onChange={(e) => updateTerm(i, "definition", e.target.value)} />
                  </td>
                  <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                    <button onClick={() => deleteTerm(i)} style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer", fontSize: 16 }}>x</button>
                  </td>
                </tr>
              ))}
            <tr>
              <td style={{ padding: "8px 12px" }}>
                <input className="input" value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder="New term" />
              </td>
              <td style={{ padding: "8px 12px" }}>
                <input className="input" value={newDef} onChange={(e) => setNewDef(e.target.value)} placeholder="Definition" />
              </td>
              <td style={{ padding: "8px 12px", textAlign: "center" }}>
                <button onClick={addTerm} className="btn btn-sm btn-primary" disabled={!newTerm.trim() || !newDef.trim()}>Add</button>
              </td>
            </tr>
          </tbody>
        </table>

        {terms.length === 0 && !loading && (
          <div className="empty-state" style={{ marginTop: 32 }}>
            <h3>No glossary terms yet</h3>
            <p>Add your first term above.</p>
          </div>
        )}
      </div>
    </>
  );
}
