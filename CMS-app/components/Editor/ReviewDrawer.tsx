"use client";

import { useEffect, useState } from "react";
import type { User } from "@/lib/types";
import Icon from "../Icon";

interface ReviewDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Emails currently assigned to this article (sourced from TOC). */
  initialAssigned: string[];
  /** Article title — shown in the drawer for context. */
  articleTitle: string;
  /** Persists the new assignment list. Drawer closes on success. */
  onSave: (emails: string[]) => Promise<void>;
}

/**
 * Right-side drawer used by tech writers to share an article with one or more
 * contributors for review. Mirrors the meta drawer's anatomy so the editor's
 * right-side affordances feel consistent.
 */
export default function ReviewDrawer({
  open,
  onClose,
  initialAssigned,
  articleTitle,
  onSave,
}: ReviewDrawerProps) {
  const [contributors, setContributors] = useState<User[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialAssigned));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset selection when drawer opens against a (possibly different) article.
  useEffect(() => {
    if (open) {
      setSelected(new Set(initialAssigned));
      setError(null);
    }
  }, [open, initialAssigned]);

  // Load the contributor list on first open. The settings page is the source
  // of truth — `/api/users` returns everyone; we filter to contributors here.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d: { users?: User[] }) => {
        if (cancelled) return;
        const list = (d.users || []).filter((u) => u.role === "contributor");
        // Stable order: by name (or email if no name).
        list.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
        setContributors(list);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setContributors([]);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  const toggle = (email: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(Array.from(selected));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setSelected(new Set(initialAssigned));
    setError(null);
    onClose();
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleCancel}
        style={{ position: "fixed", inset: 0, background: "rgba(14,22,35,0.18)", zIndex: 900 }}
      />
      {/* Drawer */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 380,
          maxWidth: "90vw",
          background: "var(--bg)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "var(--shadow-drawer)",
          zIndex: 901,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Send for review</h3>
            <p style={{ fontSize: 12, color: "var(--fg-muted)", margin: "2px 0 0", lineHeight: 1.3 }}>
              Share <span style={{ color: "var(--fg)" }}>{articleTitle}</span> with one or more
              contributors.
            </p>
          </div>
          <button
            onClick={handleCancel}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--fg-muted)",
              padding: "2px 6px",
              borderRadius: 4,
              lineHeight: 1,
            }}
            title="Close"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {!loaded ? (
            <p style={{ fontSize: 13, color: "var(--fg-muted)" }}>Loading…</p>
          ) : contributors.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--fg-muted)" }}>
              No contributors configured yet. Add one in Platform Settings → Users & Roles.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {contributors.map((c) => {
                const isSelected = selected.has(c.email);
                return (
                  <label
                    key={c.email}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      border: `1px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                      borderRadius: "var(--radius)",
                      background: isSelected ? "var(--accent-light)" : "var(--bg)",
                      cursor: "pointer",
                      transition: "border-color 0.12s, background 0.12s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(c.email)}
                      style={{ width: 16, height: 16, cursor: "pointer" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>
                        {c.name || c.email.split("@")[0]}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--fg-muted)",
                          fontFamily: "var(--font-mono)",
                          lineHeight: 1.3,
                        }}
                      >
                        {c.email}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--fg-muted)", flex: 1 }}>
            {selected.size} selected
          </span>
          {error && (
            <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>
          )}
          <button onClick={handleCancel} className="btn btn-sm" disabled={saving}>
            Cancel
          </button>
          <button onClick={handleSave} className="btn btn-sm btn-gold" disabled={saving}>
            {saving ? "Sending…" : "Send for review"}
          </button>
        </div>
      </div>
    </>
  );
}
