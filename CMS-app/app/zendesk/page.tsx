"use client";

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { canPublish } from "@/lib/permissions";
import TechWriterBlocked from "@/components/TechWriterBlocked";

/**
 * Zendesk sync — review screen.
 *
 * The one human-in-the-loop step of the sync: confirm which existing Zendesk
 * category/section each Faro node maps to, BEFORE anything is created or
 * published. A wrong match here would make the sync overwrite the wrong live
 * article, so nothing is committed until you confirm — and confirming writes
 * only the id-map (safe, reversible), never Zendesk.
 *
 * Articles themselves don't need per-item review: once the structure is locked,
 * the sync publishes them live automatically (no second click in Zendesk).
 */

type MatchStatus = "linked" | "matched" | "ambiguous" | "create" | "stale";

interface ReconcileNode {
  kind: "category" | "section";
  faroKey: string;
  name: string;
  zendeskId?: number;
  status: MatchStatus;
  candidates?: { id: number; name: string }[];
  children: ReconcileNode[];
}
interface ReconcilePlan {
  nodes: ReconcileNode[];
  orphans: {
    categories: { id: number; name: string }[];
    sections: { id: number; name: string; category_id: number }[];
  };
  summary: Record<MatchStatus, number>;
}
interface BootstrapResult {
  locale: string;
  existing: { categories: number; sections: number };
  plan: ReconcilePlan;
}

const STATUS_META: Record<MatchStatus, { label: string; bg: string; fg: string; hint: string }> = {
  linked: { label: "Linked", bg: "var(--info-light, #eff6ff)", fg: "var(--info, #2563eb)", hint: "Already mapped — will update in place." },
  matched: { label: "Match", bg: "var(--success-light, #f0fdf4)", fg: "var(--success, #15803d)", hint: "One same-named Zendesk object — confirm to link." },
  ambiguous: { label: "Choose", bg: "var(--warning-light, #fffbeb)", fg: "var(--warning, #b45309)", hint: "Several candidates — pick which one." },
  create: { label: "Create", bg: "var(--bg-subtle, #f1f5f9)", fg: "var(--fg-muted, #64748b)", hint: "No match — will be created on sync." },
  stale: { label: "Stale", bg: "var(--danger-light, #fef2f2)", fg: "var(--danger, #b91c1c)", hint: "Mapped id no longer exists in Zendesk." },
};

/** Every node whose id can be confirmed right now: a lone match, or an ambiguous
 *  node the user has picked a candidate for. */
function collectConfirmable(
  nodes: ReconcileNode[],
  picks: Record<string, number>
): { categories: Record<string, number>; sections: Record<string, number> } {
  const categories: Record<string, number> = {};
  const sections: Record<string, number> = {};
  const walk = (n: ReconcileNode) => {
    const id = n.status === "matched" ? n.zendeskId : n.status === "ambiguous" ? picks[n.faroKey] : undefined;
    if (id) (n.kind === "category" ? categories : sections)[n.faroKey] = id;
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return { categories, sections };
}

export default function ZendeskPage() {
  const { role, loaded } = useCurrentUser();
  const [result, setResult] = useState<BootstrapResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);

  const runBootstrap = async () => {
    setLoading(true);
    setError(null);
    setConfirmMsg(null);
    try {
      const res = await fetch("/api/zendesk/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Bootstrap failed");
      setResult(data as BootstrapResult);
      setPicks({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bootstrap failed");
    } finally {
      setLoading(false);
    }
  };

  const confirmable = result ? collectConfirmable(result.plan.nodes, picks) : { categories: {}, sections: {} };
  const confirmCount = Object.keys(confirmable.categories).length + Object.keys(confirmable.sections).length;
  const unresolved = result ? result.plan.summary.ambiguous - Object.keys(picks).filter((k) => picks[k]).length : 0;

  const confirmMatches = async () => {
    if (!result) return;
    setConfirming(true);
    setConfirmMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/zendesk/map", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: result.locale, ...confirmable }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to confirm");
      const locked = confirmCount;
      // Re-check FIRST (it clears messages on entry), then announce — otherwise the
      // confirmation flashes and is immediately wiped by the refresh.
      await runBootstrap();
      setConfirmMsg(`Locked ${locked} match${locked !== 1 ? "es" : ""} — now linked by id.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setConfirming(false);
    }
  };

  if (loaded && !canPublish(role)) return <TechWriterBlocked title="Zendesk sync" />;

  const s = result?.plan.summary;

  return (
    <>
      <PageHeader title="Zendesk sync">
        <button className="btn btn-primary" disabled={loading} onClick={runBootstrap}>
          {loading ? "Checking…" : result ? "Re-check" : "Check help centre"}
        </button>
      </PageHeader>

      <div className="main-body">
        <p style={{ color: "var(--fg-muted)", marginBottom: 16, fontSize: 14, maxWidth: 720 }}>
          Match the Faro table of contents against your existing Zendesk help centre. Confirm the
          category and section matches once — after that, identity is by id, so renames update in
          place instead of duplicating. Articles are published live automatically on sync; only the
          structure needs your review here.
        </p>

        {error && (
          <div style={{ background: "var(--danger-light)", color: "var(--danger)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>
            {error}
          </div>
        )}
        {confirmMsg && (
          <div style={{ background: "var(--success-light, var(--info-light))", color: "var(--success, var(--info))", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>
            {confirmMsg}
          </div>
        )}

        {!result && !loading && (
          <div style={{ border: "1px dashed var(--border)", borderRadius: "var(--radius)", padding: 32, textAlign: "center", color: "var(--fg-muted)", fontSize: 14 }}>
            Run <strong>Check help centre</strong> to fetch the existing categories and sections and
            see the proposed matches. Nothing is written to Zendesk.
          </div>
        )}

        {result && s && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 16, fontSize: 13 }}>
              <span style={{ color: "var(--fg-muted)" }}>
                Zendesk has {result.existing.categories} categories, {result.existing.sections} sections ({result.locale}).
              </span>
              {(["linked", "matched", "ambiguous", "create", "stale"] as MatchStatus[])
                .filter((k) => s[k] > 0)
                .map((k) => (
                  <span key={k} style={{ background: STATUS_META[k].bg, color: STATUS_META[k].fg, padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
                    {s[k]} {STATUS_META[k].label.toLowerCase()}
                  </span>
                ))}
            </div>

            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 16 }}>
              {result.plan.nodes.map((node) => (
                <NodeRow key={node.faroKey} node={node} depth={0} picks={picks} setPicks={setPicks} />
              ))}
              {result.plan.nodes.length === 0 && (
                <div style={{ padding: 16, color: "var(--fg-muted)", fontSize: 14 }}>The TOC has no categories.</div>
              )}
            </div>

            {(result.plan.orphans.categories.length > 0 || result.plan.orphans.sections.length > 0) && (
              <div style={{ background: "var(--bg-subtle, #f8fafc)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 12, marginBottom: 16, fontSize: 13 }}>
                <strong>In Zendesk, not in Faro</strong> — left untouched, never deleted:
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--fg-muted)" }}>
                  {result.plan.orphans.categories.map((c) => (
                    <li key={`c${c.id}`}>Category “{c.name}” (#{c.id})</li>
                  ))}
                  {result.plan.orphans.sections.map((sec) => (
                    <li key={`s${sec.id}`}>Section “{sec.name}” (#{sec.id})</li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="btn btn-primary" disabled={confirming || confirmCount === 0 || unresolved > 0} onClick={confirmMatches}>
                {confirming ? "Confirming…" : `Confirm ${confirmCount} match${confirmCount !== 1 ? "es" : ""}`}
              </button>
              {unresolved > 0 && (
                <span style={{ fontSize: 13, color: "var(--warning)" }}>
                  Resolve {unresolved} ambiguous match{unresolved !== 1 ? "es" : ""} first.
                </span>
              )}
              {s.create > 0 && (
                <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>
                  {s.create} item{s.create !== 1 ? "s" : ""} will be created on sync.
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function NodeRow({
  node, depth, picks, setPicks,
}: {
  node: ReconcileNode;
  depth: number;
  picks: Record<string, number>;
  setPicks: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}) {
  const meta = STATUS_META[node.status];
  return (
    <>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 12px 8px", paddingLeft: 12 + depth * 20,
          borderTop: depth === 0 ? "1px solid var(--border)" : "none",
          fontSize: 14,
        }}
      >
        <span style={{ fontWeight: node.kind === "category" ? 600 : 400 }}>{node.name}</span>
        <span
          title={meta.hint}
          style={{ background: meta.bg, color: meta.fg, padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600 }}
        >
          {meta.label}
        </span>
        {(node.status === "linked" || node.status === "matched") && node.zendeskId && (
          <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>#{node.zendeskId}</span>
        )}
        {node.status === "ambiguous" && node.candidates && (
          <select
            value={picks[node.faroKey] ?? ""}
            onChange={(e) => {
              const id = Number(e.target.value);
              setPicks((prev) => {
                const next = { ...prev };
                if (id) next[node.faroKey] = id;
                else delete next[node.faroKey];
                return next;
              });
            }}
            style={{ fontSize: 12, padding: "2px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)" }}
          >
            <option value="">Pick one…</option>
            {node.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (#{c.id})
              </option>
            ))}
          </select>
        )}
      </div>
      {node.children.map((child) => (
        <NodeRow key={child.faroKey} node={child} depth={depth + 1} picks={picks} setPicks={setPicks} />
      ))}
    </>
  );
}
