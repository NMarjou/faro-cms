"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import type { Toc, TocArticle } from "@/lib/types";
import Icon from "@/components/Icon";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import ArticleStatusBadge from "@/components/ArticleStatusBadge";

interface DashboardStats {
  articles: number;
  categories: number;
  snippets: number;
  variables: number;
}

interface RecentArticle {
  title: string;
  file: string;
  lastModified?: string;
  // Carried through so the dashboard can render a status badge without
  // re-fetching. Keeps `RecentArticle` thin while staying status-aware.
  assignedTo?: string[];
  reviewComplete?: boolean;
  published?: boolean;
}

function collectAllArticles(toc: Toc): TocArticle[] {
  const all: TocArticle[] = [];
  for (const cat of toc.categories || []) {
    for (const sec of cat.sections || []) {
      all.push(...sec.articles);
      if (sec.subsections) {
        for (const sub of sec.subsections) {
          all.push(...sub.articles);
        }
      }
    }
  }
  if (toc.articles) all.push(...toc.articles);
  return all;
}

export default function DashboardPage() {
  const { user, role, loaded: userLoaded } = useCurrentUser();
  const isContributor = role === "contributor";
  const [stats, setStats] = useState<DashboardStats>({ articles: 0, categories: 0, snippets: 0, variables: 0 });
  const [recent, setRecent] = useState<RecentArticle[]>([]);
  const [assigned, setAssigned] = useState<RecentArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [tocRes, snippetsRes, variablesRes] = await Promise.all([
          fetch("/api/toc").catch(() => null),
          fetch("/api/snippets").catch(() => null),
          fetch("/api/variables").catch(() => null),
        ]);

        let articleCount = 0;
        let categoryCount = 0;
        const recentArticles: RecentArticle[] = [];
        const assignedArticles: RecentArticle[] = [];

        if (tocRes?.ok) {
          const toc: Toc = await tocRes.json();
          categoryCount = toc.categories?.length || 0;
          const allArticles = collectAllArticles(toc);
          articleCount = allArticles.length;

          // Get last 5 by lastModified (most recent first)
          const sorted = [...allArticles]
            .filter((a) => a.lastModified)
            .sort((a, b) => (b.lastModified || "").localeCompare(a.lastModified || ""));
          // If not enough with dates, pad with any articles
          const withDates = sorted.slice(0, 5);
          if (withDates.length < 5) {
            const remaining = allArticles.filter((a) => !a.lastModified).slice(0, 5 - withDates.length);
            withDates.push(...remaining);
          }
          for (const a of withDates.slice(0, 5)) {
            recentArticles.push({
              title: a.title,
              file: a.file,
              lastModified: a.lastModified,
              assignedTo: a.assignedTo,
              reviewComplete: a.reviewComplete,
              published: a.published,
            });
          }

          // Articles where the current contributor appears in `assignedTo`.
          // For tech writers this is empty (they see all-recent above instead).
          if (user?.email) {
            const me = user.email.toLowerCase();
            const myArticles = allArticles
              .filter((a) => a.assignedTo?.some((e) => e.toLowerCase() === me))
              .sort((a, b) => (b.lastModified || "").localeCompare(a.lastModified || ""));
            for (const a of myArticles) {
              assignedArticles.push({
                title: a.title,
                file: a.file,
                lastModified: a.lastModified,
                assignedTo: a.assignedTo,
                reviewComplete: a.reviewComplete,
                published: a.published,
              });
            }
          }
        }

        let snippetCount = 0;
        if (snippetsRes?.ok) {
          const data = await snippetsRes.json();
          snippetCount = data.snippets?.length || 0;
        }

        let variableCount = 0;
        if (variablesRes?.ok) {
          const vars = await variablesRes.json();
          variableCount = Object.keys(vars).length;
        }

        setStats({ articles: articleCount, categories: categoryCount, snippets: snippetCount, variables: variableCount });
        setRecent(recentArticles);
        setAssigned(assignedArticles);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    // Wait until the current user is resolved so the assigned-to filter has
    // a real email to match against.
    if (userLoaded) load();
  }, [userLoaded, user?.email]);

  // ── Contributor view ─────────────────────────────────────────────────────
  // Limited dashboard: their assigned articles + recent activity from the
  // assigned set. No stats, no quick actions, no admin info.
  if (isContributor) {
    return (
      <>
        <PageHeader title="Dashboard">
        </PageHeader>
        <div className="main-body" style={{ backgroundImage: "var(--paper-grain)" }}>
          <div style={{ maxWidth: 880, margin: "0 auto", width: "100%" }}>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 500,
                fontSize: 30,
                letterSpacing: ".005em",
                margin: "0 0 4px",
                color: "var(--fg)",
              }}
            >
              {user?.name ? `Welcome back, ${user.name.split(" ")[0]}` : "Welcome back"}
            </h2>
            <p
              style={{
                margin: "0 0 28px",
                color: "var(--fg-muted)",
                fontSize: 14,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
              }}
            >
              Articles a tech writer has shared with you for review.
            </p>

            <h3 className="faro-h2" style={{ margin: "0 0 14px" }}>Assigned to me</h3>
            {loading ? (
              <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>Loading…</p>
            ) : assigned.length === 0 ? (
              <div className="card" style={{ padding: 20, color: "var(--fg-muted)", fontSize: 14 }}>
                No articles assigned to you yet.
              </div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 32 }}>
                {assigned.map((article, i) => (
                  <Link
                    key={article.file}
                    href={`/editor/${encodeURIComponent(article.file)}`}
                    className="recent-article-row"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "14px 20px",
                      textDecoration: "none",
                      color: "inherit",
                      borderTop: i > 0 ? "1px solid var(--border-soft)" : undefined,
                      transition: "background 0.1s",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>{article.title}</div>
                      <div style={{ fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.3, fontFamily: "var(--font-mono)" }}>
                        updated {article.lastModified || "—"}
                      </div>
                    </div>
                    <ArticleStatusBadge article={article} />
                  </Link>
                ))}
              </div>
            )}

            {/* Recent activity — limited to the contributor's assigned set so
                they don't see article titles they can't open. */}
            {assigned.length > 0 && (
              <>
                <h3 className="faro-h2" style={{ margin: "0 0 14px" }}>Recent activity</h3>
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  {[...assigned]
                    .sort((a, b) => (b.lastModified || "").localeCompare(a.lastModified || ""))
                    .slice(0, 5)
                    .map((article, i) => (
                      <Link
                        key={`recent-${article.file}`}
                        href={`/editor/${encodeURIComponent(article.file)}`}
                        className="recent-article-row"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "14px 20px",
                          textDecoration: "none",
                          color: "inherit",
                          borderTop: i > 0 ? "1px solid var(--border-soft)" : undefined,
                          transition: "background 0.1s",
                        }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{article.title}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <ArticleStatusBadge article={article} />
                          <span style={{ fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}>
                            {article.lastModified || "—"}
                          </span>
                        </div>
                      </Link>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── Tech writer view (default) ───────────────────────────────────────────
  return (
    <>
      <PageHeader title="Dashboard">
        <Link href="/articles/new" className="btn btn-primary">
          New Article
        </Link>
      </PageHeader>
      <div className="main-body" style={{ backgroundImage: "var(--paper-grain)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", width: "100%" }}>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 500,
              fontSize: 30,
              letterSpacing: ".005em",
              margin: "0 0 4px",
              color: "var(--fg)",
            }}
          >
            Welcome back
          </h2>
          <p
            style={{
              margin: "0 0 28px",
              color: "var(--fg-muted)",
              fontSize: 14,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
            }}
          >
            Here&apos;s what&apos;s in your workspace.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 16,
              marginBottom: 36,
            }}
          >
            <div className="stat-card">
              <div className="stat-value">{loading ? "--" : stats.articles}</div>
              <div className="stat-label">Articles</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{loading ? "--" : stats.categories}</div>
              <div className="stat-label">Categories</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{loading ? "--" : stats.snippets}</div>
              <div className="stat-label">Snippets</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{loading ? "--" : stats.variables}</div>
              <div className="stat-label">Variables</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 28 }}>
            {/* Recent Articles */}
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <h3 className="faro-h2" style={{ margin: 0 }}>Recent articles</h3>
                <Link
                  href="/articles"
                  style={{
                    color: "var(--accent-hover)",
                    fontSize: 13,
                    textDecoration: "none",
                  }}
                >
                  View all →
                </Link>
              </div>
              {loading ? (
                <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>Loading…</p>
              ) : recent.length > 0 ? (
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  {recent.map((article, i) => (
                    <Link
                      key={article.file}
                      href={`/editor/${encodeURIComponent(article.file)}`}
                      className="recent-article-row"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "14px 20px",
                        textDecoration: "none",
                        color: "inherit",
                        borderTop: i > 0 ? "1px solid var(--border-soft)" : undefined,
                        transition: "background 0.1s",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>{article.title}</div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--fg-muted)",
                            lineHeight: 1.3,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          updated {article.lastModified || "—"}
                        </div>
                      </div>
                      <ArticleStatusBadge article={article} />
                    </Link>
                  ))}
                </div>
              ) : (
                <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>No articles yet.</p>
              )}
            </div>

            {/* Quick Actions */}
            <div>
              <h3 className="faro-h2" style={{ margin: "0 0 14px" }}>Quick actions</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Link href="/articles/new" className="card quick-action-card" style={{ textDecoration: "none", color: "inherit", padding: 16 }}>
                  <div style={{ color: "var(--highlight)", marginBottom: 10 }}>
                    <Icon name="file-text" size={22} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Create Article</div>
                  <div style={{ fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.4 }}>Write a new knowledge base article</div>
                </Link>
                <Link href="/publish" className="card quick-action-card" style={{ textDecoration: "none", color: "inherit", padding: 16 }}>
                  <div style={{ color: "var(--highlight)", marginBottom: 10 }}>
                    <Icon name="cloud-arrow-up" size={22} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Publish Site</div>
                  <div style={{ fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.4 }}>Deploy static output to your host</div>
                </Link>
                <Link href="/import" className="card quick-action-card" style={{ textDecoration: "none", color: "inherit", padding: 16 }}>
                  <div style={{ color: "var(--highlight)", marginBottom: 10 }}>
                    <Icon name="download-simple" size={22} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Import from MadCap</div>
                  <div style={{ fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.4 }}>Bring in an existing Flare project</div>
                </Link>
                <Link href="/toc" className="card quick-action-card" style={{ textDecoration: "none", color: "inherit", padding: 16 }}>
                  <div style={{ color: "var(--highlight)", marginBottom: 10 }}>
                    <Icon name="list" size={22} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Build TOC</div>
                  <div style={{ fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.4 }}>Organize navigation hierarchy</div>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
