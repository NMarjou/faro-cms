"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Suggestion } from "@/lib/types";
import Icon from "@/components/Icon";
import { useCurrentUser } from "@/components/CurrentUserProvider";

interface QueueEntry {
  articleFile: string;
  articleTitle: string;
  articleSlug: string;
  pending: number;
  previews: Suggestion[];
  needsSignoff: boolean;
  assignedCount: number;
  reviewsDoneCount: number;
}

export default function ReviewQueuePage() {
  const { role, loaded: userLoaded } = useCurrentUser();
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [totalPending, setTotalPending] = useState(0);
  const [totalSignoffs, setTotalSignoffs] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/suggestions")
      .then((r) => (r.ok ? r.json() : { articles: [], totalPending: 0, totalSignoffs: 0 }))
      .then((d: { articles?: QueueEntry[]; totalPending?: number; totalSignoffs?: number }) => {
        if (cancelled) return;
        setEntries(d.articles || []);
        setTotalPending(d.totalPending || 0);
        setTotalSignoffs(d.totalSignoffs || 0);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (userLoaded && role === "contributor") {
    return (
      <>
        <header className="main-header">
          <h1>Review Queue</h1>
        </header>
        <div className="main-body">
          <div className="card" style={{ maxWidth: 600, color: "var(--fg-muted)" }}>
            The review queue is available to tech writers only.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="main-header">
        <h1>Review Queue</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {!loading && totalPending > 0 && (
            <span
              className="badge"
              style={{
                background: "var(--warning-light)",
                color: "var(--warning)",
                border: "1px solid var(--warning)",
              }}
            >
              {totalPending} pending
            </span>
          )}
          {!loading && totalSignoffs > 0 && (
            <span
              className="badge"
              style={{
                background: "var(--info-light)",
                color: "var(--info)",
                border: "1px solid var(--info)",
              }}
              title="Articles sent for review that are still awaiting your sign-off"
            >
              {totalSignoffs} awaiting sign-off
            </span>
          )}
        </div>
      </header>
      <div className="main-body" style={{ backgroundImage: "var(--paper-grain)" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", width: "100%" }}>
          <p
            style={{
              margin: "0 0 24px",
              color: "var(--fg-muted)",
              fontSize: 14,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
            }}
          >
            Articles with suggestions to resolve or sign-offs to confirm.
          </p>

          {loading ? (
            <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>Loading…</p>
          ) : entries.length === 0 ? (
            <div className="card" style={{ padding: 32, color: "var(--fg-muted)", fontSize: 14, textAlign: "center" }}>
              Nothing waiting. Nice and quiet.
            </div>
          ) : (
            <div className="review-queue-list">
              {entries.map((e) => (
                <Link
                  key={e.articleFile}
                  href={`/editor/${encodeURIComponent(e.articleFile)}`}
                  className="review-queue-card"
                >
                  <div className="review-queue-card-head">
                    <div className="review-queue-card-title">{e.articleTitle}</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {e.pending > 0 && (
                        <span className="review-queue-card-count">
                          <Icon name="git-pull-request" size={12} />
                          {e.pending} pending
                        </span>
                      )}
                      {e.needsSignoff && (
                        <span
                          className="review-queue-card-count"
                          style={{
                            background: "var(--info-light)",
                            color: "var(--info)",
                            border: "1px solid var(--info)",
                          }}
                          title={
                            e.assignedCount > 0
                              ? `Awaiting your sign-off (${e.reviewsDoneCount}/${e.assignedCount} contributors done)`
                              : "Awaiting your sign-off"
                          }
                        >
                          <Icon name="check-circle" size={12} />
                          Sign off
                          {e.assignedCount > 0 ? ` (${e.reviewsDoneCount}/${e.assignedCount})` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="review-queue-card-path">{e.articleFile}</div>
                  {e.previews.length > 0 && (
                    <div className="review-queue-card-previews">
                      {e.previews.map((s) => (
                        <div key={s.id} className="review-queue-preview">
                          <span className="review-queue-preview-author">
                            {s.authorName || s.author}
                          </span>
                          <span className="review-queue-preview-arrow">·</span>
                          <span className="review-queue-preview-diff">
                            <span className="diff-original">{s.originalText}</span>
                            <span className="diff-arrow"> → </span>
                            <span className="diff-suggested">{s.suggestedText}</span>
                          </span>
                        </div>
                      ))}
                      {e.pending > e.previews.length && (
                        <div className="review-queue-preview-more">
                          + {e.pending - e.previews.length} more
                        </div>
                      )}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
