"use client";

import { useEffect, useState, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useCurrentProject } from "@/components/CurrentProjectProvider";
import { isTechWriter } from "@/lib/permissions";
import TechWriterBlocked from "@/components/TechWriterBlocked";
import { useHighlightParams, useFlashHighlight } from "@/components/searchHighlight";
import type { ConditionsConfig } from "@/lib/types";

type Scope = "shared" | "project";
type TagScopes = Record<string, "shared" | "project">;
type ArticleRef = { file: string; title: string };
type Usage = Record<string, { labels: ArticleRef[]; inline: ArticleRef[] }>;

const DEFAULT_COLOR = "#6b7280";

export default function ConditionsPage() {
  const { role, loaded } = useCurrentUser();
  const { project, projects } = useCurrentProject();
  const projectLabel =
    projects.find((p) => p.slug === project)?.name || project || "this project";

  const [scope, setScope] = useState<Scope>("shared");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");

  // Shared pool (always loaded — project mode needs it as the baseline).
  const [sharedTags, setSharedTags] = useState<string[]>([]);
  const [sharedColors, setSharedColors] = useState<Record<string, string>>({});
  // The view being edited: merged in project mode, the pool in shared mode.
  const [tags, setTags] = useState<string[]>([]);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<TagScopes>({});
  const [usage, setUsage] = useState<Usage>({});

  const flash = (m: string) => { setMessage(m); setTimeout(() => setMessage(null), 2000); };

  const loadData = useCallback(async (s: Scope) => {
    setLoading(true);
    try {
      // no-store: /api/conditions is browser-cacheable (max-age=60), but this is
      // the editor for it — after a write we must see the authoritative state,
      // not a stale copy. (Without this the page silently shows pre-save data:
      // an override lands on disk while the UI still reports "Shared".)
      const opts: RequestInit = { cache: "no-store" };
      const shared: ConditionsConfig = await fetch("/api/conditions?scope=shared", opts).then((r) => r.json());
      setSharedTags(shared.tags || []);
      setSharedColors(shared.colors || {});
      if (s === "shared") {
        setTags(shared.tags || []);
        setColors(shared.colors || {});
        setScopes({});
      } else {
        const merged: ConditionsConfig & { scopes?: TagScopes } =
          await fetch("/api/conditions", opts).then((r) => r.json());
        setTags(merged.tags || []);
        setColors(merged.colors || {});
        setScopes(merged.scopes || {});
      }
    } catch {
      setError("Failed to load conditions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(scope); }, [scope, loadData]);

  // Usage is what makes delete safe — see lib/conditions-usage.ts.
  useEffect(() => {
    fetch("/api/conditions/usage")
      .then((r) => r.json())
      .then((d) => setUsage(d.usage || {}))
      .catch(() => {});
  }, []);

  // Search deep-link (search results for a condition land here).
  const { highlight, scope: wantScope } = useHighlightParams();
  useEffect(() => {
    if (wantScope === "shared" || wantScope === "project") setScope(wantScope);
  }, [wantScope]);
  useFlashHighlight(highlight, !loading && (!wantScope || scope === wantScope));

  const save = async (nextTags: string[], nextColors: Record<string, string>) => {
    setSaving(true);
    setError(null);
    try {
      // In project mode the overlay is SPARSE: only project-only tags, and only
      // the colors that actually differ from the shared pool. A project can add
      // and recolour, but can't hide a shared tag (mergeConditions unions them).
      const payload: ConditionsConfig =
        scope === "shared"
          ? { tags: nextTags, colors: nextColors }
          : {
              tags: nextTags.filter((t) => !sharedTags.includes(t)),
              colors: Object.fromEntries(
                nextTags
                  .filter((t) => !sharedTags.includes(t) || nextColors[t] !== sharedColors[t])
                  .map((t) => [t, nextColors[t] ?? DEFAULT_COLOR])
              ),
            };
      const res = await fetch(`/api/conditions?scope=${scope}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save");
      }
      flash("Saved");
      loadData(scope);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const t = newTag.trim().toLowerCase().replace(/\s+/g, "-");
    if (!t || tags.includes(t)) { setNewTag(""); return; }
    setNewTag("");
    save([...tags, t], { ...colors, [t]: colors[t] ?? DEFAULT_COLOR });
  };

  const setColor = (tag: string, color: string) => {
    const next = { ...colors, [tag]: color };
    setColors(next);
    save(tags, next);
  };

  /**
   * Deleting a tag that's still used INLINE is destructive and silent: the tag
   * can no longer be an active audience, so compile strips that content from
   * every published build. Spell that out rather than a generic "are you sure".
   */
  const removeTag = (tag: string) => {
    const u = usage[tag] || { labels: [], inline: [] };
    const lines: string[] = [`Delete condition "${tag}"?`];
    if (u.inline.length) {
      lines.push(
        "",
        `⚠️  ${u.inline.length} article${u.inline.length === 1 ? "" : "s"} contain content gated on this tag:`,
        ...u.inline.slice(0, 5).map((a) => `   • ${a.title}`),
        u.inline.length > 5 ? `   • …and ${u.inline.length - 5} more` : "",
        "",
        "That content will be STRIPPED FROM PUBLISHED OUTPUT — the tag can no longer be selected as an audience. It won't error; the content just disappears.",
      );
    }
    if (u.labels.length) {
      lines.push("", `${u.labels.length} article${u.labels.length === 1 ? "" : "s"} use it as a label (the label is simply dropped).`);
    }
    if (!u.inline.length && !u.labels.length) lines.push("", "It isn't used by any article.");
    if (!confirm(lines.filter((l) => l !== "").join("\n"))) return;

    const next = { ...colors };
    delete next[tag];
    save(tags.filter((t) => t !== tag), next);
  };

  const revertOverride = (tag: string) => {
    // Drop the project's colour override → falls back to the shared colour.
    const next = { ...colors, [tag]: sharedColors[tag] ?? DEFAULT_COLOR };
    setColors(next);
    save(tags, next);
  };

  const clearAllOverrides = async () => {
    if (!confirm(`Clear all condition overrides for ${projectLabel}? Project-only tags will be removed and colours revert to shared.`)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/conditions?scope=project", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear overrides");
      flash("Overrides cleared");
      loadData("project");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear overrides");
    } finally {
      setSaving(false);
    }
  };

  if (loaded && !isTechWriter(role)) return <TechWriterBlocked title="Conditions" />;

  const overrideCount = Object.values(scopes).filter((s) => s === "project").length;

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
      <PageHeader title="Conditions">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {message && <span style={{ fontSize: 13, color: "var(--success)" }}>{message}</span>}
          <ScopeToggle />
          {scope === "project" && overrideCount > 0 && (
            <button onClick={clearAllOverrides} disabled={saving} className="btn btn-sm">Clear overrides</button>
          )}
        </div>
      </PageHeader>
      <div className="main-body">
        {error && (
          <div style={{ background: "var(--danger-light)", color: "var(--danger)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14, display: "flex", gap: 8 }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button className="btn btn-sm" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
        {loading && <p>Loading...</p>}

        <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14 }}>
          {scope === "shared" ? (
            <>Condition tags — available in every project. They gate content at publish time (only content whose tags match the selected audience ships) and double as the article label vocabulary. Changes here affect all projects.</>
          ) : (
            <>Condition overrides for <strong>{projectLabel}</strong> ({overrideCount}). A project can add its own tags and recolour shared ones, but can&apos;t hide a shared tag.</>
          )}
        </p>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, maxWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ ...headCell, width: 40 }} />
              <th style={headCell}>Tag</th>
              {scope === "project" && <th style={{ ...headCell, width: 110 }}>Scope</th>}
              <th style={{ ...headCell, width: 260 }}>Used by</th>
              <th style={{ ...headCell, width: 120 }} />
            </tr>
          </thead>
          <tbody>
            {tags.map((tag) => {
              const u = usage[tag] || { labels: [], inline: [] };
              const isProject = scopes[tag] === "project";
              const isProjectOnly = !sharedTags.includes(tag);
              return (
                <tr key={tag} data-highlight-id={tag}>
                  <td style={cell}>
                    <input
                      type="color"
                      value={colors[tag] || DEFAULT_COLOR}
                      onChange={(e) => setColor(tag, e.target.value)}
                      title="Tag colour"
                      style={{ width: 26, height: 26, padding: 0, border: "1px solid var(--border)", borderRadius: 4, background: "none", cursor: "pointer" }}
                    />
                  </td>
                  <td style={{ ...cell, fontFamily: "var(--font-mono)", fontSize: 13 }}>{tag}</td>
                  {scope === "project" && (
                    <td style={cell}>
                      <span className={isProject ? "badge badge-accent" : "badge"}>
                        {isProject ? (isProjectOnly ? projectLabel : "Recoloured") : "Shared"}
                      </span>
                    </td>
                  )}
                  <td style={{ ...cell, fontSize: 12, color: "var(--fg-muted)" }}>
                    {u.inline.length > 0 && (
                      <span title={u.inline.map((a) => a.title).join("\n")} style={{ color: "var(--warning)", fontWeight: 500 }}>
                        {u.inline.length} article{u.inline.length === 1 ? "" : "s"} gated
                      </span>
                    )}
                    {u.inline.length > 0 && u.labels.length > 0 && " · "}
                    {u.labels.length > 0 && (
                      <span title={u.labels.map((a) => a.title).join("\n")}>
                        {u.labels.length} labelled
                      </span>
                    )}
                    {u.inline.length === 0 && u.labels.length === 0 && "—"}
                  </td>
                  <td style={{ ...cell, textAlign: "right" }}>
                    {scope === "shared" ? (
                      <button className="btn btn-sm btn-danger" disabled={saving} onClick={() => removeTag(tag)}>Delete</button>
                    ) : isProjectOnly ? (
                      <button className="btn btn-sm btn-danger" disabled={saving} onClick={() => removeTag(tag)}>Remove</button>
                    ) : isProject ? (
                      <button className="btn btn-sm" disabled={saving} onClick={() => revertOverride(tag)}>Revert</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td style={{ padding: "8px 12px" }} />
              <td style={{ padding: "8px 12px" }} colSpan={scope === "project" ? 2 : 1}>
                <input
                  className="input"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addTag(); }}
                  placeholder={scope === "shared" ? "new-condition" : "project-only-condition"}
                  style={{ fontFamily: "var(--font-mono)", fontSize: 13, maxWidth: 240 }}
                />
              </td>
              <td style={{ padding: "8px 12px" }} />
              <td style={{ padding: "8px 12px", textAlign: "right" }}>
                <button onClick={addTag} className="btn btn-sm btn-primary" disabled={!newTag.trim() || saving}>Add</button>
              </td>
            </tr>
          </tbody>
        </table>

        {tags.length === 0 && !loading && (
          <div className="empty-state" style={{ marginTop: 32 }}>
            <h3>No conditions yet</h3>
            <p>Add a condition tag to gate content by audience.</p>
          </div>
        )}
      </div>
    </>
  );
}
