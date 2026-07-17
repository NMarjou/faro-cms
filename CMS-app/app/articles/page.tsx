"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import type { Toc, TocCategory, TocSection, TocArticle } from "@/lib/types";
import { flattenTocArticles, articlesInSections } from "@/lib/toc-walk";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { canCreateArticles, canEditArticle } from "@/lib/permissions";
import ArticleStatusBadge from "@/components/ArticleStatusBadge";
import Icon from "@/components/Icon";

export default function ArticlesPage() {
  const { role, user } = useCurrentUser();
  const canCreate = canCreateArticles(role);
  const [toc, setToc] = useState<Toc | null>(null);
  const [loading, setLoading] = useState(true);
  // Two-step delete: first click arms the row, second confirms. Deleting removes
  // the article AND its TOC entry, and (once synced) deletes it from Zendesk —
  // so it must never be one stray click away.
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  );
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    fetch("/api/toc")
      .then((r) => r.json())
      .then((data) => {
        setToc(data);
        // Expand all categories by default, plus the Uncategorized group so
        // unfiled articles are visible (and nagging) on load.
        if (data.categories) {
          setExpandedCategories(
            new Set([
              ...data.categories.map((c: TocCategory) => c.slug),
              "__uncategorized__",
            ])
          );
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const deleteArticle = async (article: TocArticle) => {
    setDeleting(article.file);
    setDeleteError(null);
    try {
      const res = await fetch("/api/article/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: article.file }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed");
      // Re-read rather than patch local state: the server owns the TOC, and a
      // stale list here would misreport what's actually gone.
      const fresh = await fetch("/api/toc", { cache: "no-store" }).then((r) => r.json());
      setToc(fresh);
      setArmedDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const toggleCategory = (slug: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const toggleSection = (slug: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  // Counts articles in subsections too (the hand-rolled version didn't, so the
  // header under-reported). Standalone articles are reported separately.
  const countArticles = (toc: Toc): number =>
    flattenTocArticles(toc, { includeUncategorized: false }).length;

  /** A section and, recursively, its subsections — the TOC nests to any depth,
   *  so the browser must too or those articles are simply invisible here. */
  const renderSection = (section: TocSection, depth = 0) => {
    const total = articlesInSections([section]).length; // includes nested
    const isOpen = expandedSections.has(section.slug);
    return (
      <div key={section.slug} style={{ marginBottom: 4, marginLeft: depth ? 16 : 0 }}>
        <button
          onClick={() => toggleSection(section.slug)}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            padding: "8px 12px", background: "none", border: "none",
            fontSize: depth ? 13 : 14, fontWeight: 500, cursor: "pointer",
            textAlign: "left", color: "var(--fg)",
          }}
        >
          <span style={{ fontSize: 10, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
            ▶
          </span>
          {section.name}
          <span className="badge" style={{ marginLeft: "auto" }}>{total}</span>
        </button>
        {isOpen && (
          <div style={{ paddingLeft: 24 }}>
            {section.articles.map(renderArticleRow)}
            {section.subsections?.map((sub) => renderSection(sub, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // One row in the article list — shared by categorized sections and the
  // Uncategorized group below.
  const renderArticleRow = (article: TocArticle) => {
    const reviewDone =
      !!article.reviewsDone && article.reviewsDone.length > 0;
    const allReviewersDone =
      reviewDone &&
      article.assignedTo &&
      article.assignedTo.length === article.reviewsDone!.length;
    const submitted = article.approvalStatus === "submitted";
    return (
      <Link
        key={article.file}
        href={`/editor/${encodeURIComponent(article.file)}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          fontSize: 14,
          borderRadius: "var(--radius)",
          color: "var(--fg)",
          background: reviewDone ? "var(--success-light)" : undefined,
          borderLeft: reviewDone
            ? "3px solid var(--success)"
            : "3px solid transparent",
        }}
      >
        <span style={{ flex: 1 }}>{article.title}</span>
        <ArticleStatusBadge article={article} />
        {submitted && (
          <span
            className="badge"
            title={
              article.submittedBy
                ? `Submitted for approval by ${article.submittedBy}`
                : "Submitted for approval"
            }
            style={{
              background: "var(--warning-light)",
              color: "var(--warning)",
              border: "1px solid var(--warning)",
            }}
          >
            Submitted
          </span>
        )}
        {reviewDone && (
          <span
            title={`Review done by: ${article.reviewsDone!.join(", ")}`}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--success)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            ✓ Review done
            {article.assignedTo && article.assignedTo.length > 0 && (
              <span style={{ opacity: 0.75, fontWeight: 500 }}>
                ({article.reviewsDone!.length}/{article.assignedTo.length})
              </span>
            )}
            {allReviewersDone && <span style={{ marginLeft: 2 }}>·</span>}
          </span>
        )}
        {canEditArticle(role, article, user?.email) && (
          // Inside a <Link>, so every click here must preventDefault or the row
          // navigates to the editor instead of arming/confirming the delete.
          armedDelete === article.file ? (
            <>
              <span style={{ fontSize: 12, color: "var(--danger)" }}>Delete permanently?</span>
              <button
                className="btn"
                disabled={deleting === article.file}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteArticle(article); }}
                style={{ fontSize: 11, padding: "2px 8px", color: "var(--danger)", borderColor: "var(--danger)" }}
              >
                {deleting === article.file ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                className="btn"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setArmedDelete(null); }}
                style={{ fontSize: 11, padding: "2px 8px" }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              title="Delete this article and its TOC entry"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteError(null); setArmedDelete(article.file); }}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--fg-muted)", fontSize: 14, lineHeight: 1, padding: "2px 6px",
              }}
            >
              ×
            </button>
          )
        )}
      </Link>
    );
  };

  const standalone = toc?.articles ?? [];

  return (
    <>
      <PageHeader title="Articles">
        {canCreate && (
          <Link href="/articles/new" className="btn btn-primary">
            New Article
          </Link>
        )}
      </PageHeader>
      <div className="main-body">
        {deleteError && (
          <div style={{ background: "var(--danger-light)", color: "var(--danger)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 12, fontSize: 14 }}>
            {deleteError}
          </div>
        )}
        {loading && <p>Loading articles...</p>}
        {!loading && !toc && (
          <div className="empty-state">
            <h3>No content found</h3>
            <p>
              Set up your content/toc.json or run the migration script to get
              started.
            </p>
          </div>
        )}
        {toc && (
          <>
            <p style={{ color: "var(--fg-muted)", marginBottom: 16 }}>
              {countArticles(toc)} articles across {toc.categories.length}{" "}
              categories
              {standalone.length > 0 &&
                ` · ${standalone.length} uncategorized`}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {toc.categories.map((category) => (
                <div key={category.slug}>
                  <button
                    onClick={() => toggleCategory(category.slug)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "10px 12px",
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      fontSize: 15,
                      fontWeight: 600,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        transform: expandedCategories.has(category.slug)
                          ? "rotate(90deg)"
                          : "none",
                        transition: "transform 0.15s",
                      }}
                    >
                      ▶
                    </span>
                    {category.icon && (
                      <Icon name={category.icon} size={16} style={{ color: "var(--fg-muted)" }} />
                    )}
                    {category.name}
                    <span className="badge" style={{ marginLeft: "auto" }}>
                      {category.sections.reduce(
                        (n, s) => n + s.articles.length,
                        0
                      )}
                    </span>
                  </button>
                  {category.description && (
                    <p style={{ fontSize: 12, color: "var(--fg-muted)", margin: "4px 0 0 30px" }}>
                      {category.description}
                    </p>
                  )}
                  {expandedCategories.has(category.slug) && (
                    <div style={{ paddingLeft: 20, marginTop: 4 }}>
                      {category.sections.map((section) => renderSection(section))}
                    </div>
                  )}
                </div>
              ))}

              {/* Standalone articles — not filed into any category/section.
                  This is what "New Article" creates. As a content-org best
                  practice these shouldn't linger here; the group is styled to
                  nudge filing them into a category (via the TOC editor). */}
              {standalone.length > 0 && (
                <div>
                  <button
                    onClick={() => toggleCategory("__uncategorized__")}
                    title="Articles not yet filed into a category — organize them in the Table of Contents"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "10px 12px",
                      background: "var(--warning-light)",
                      border: "1px solid var(--warning)",
                      borderRadius: "var(--radius)",
                      fontSize: 15,
                      fontWeight: 600,
                      cursor: "pointer",
                      textAlign: "left",
                      color: "var(--warning)",
                    }}
                  >
                    <span
                      style={{
                        transform: expandedCategories.has("__uncategorized__")
                          ? "rotate(90deg)"
                          : "none",
                        transition: "transform 0.15s",
                      }}
                    >
                      ▶
                    </span>
                    Uncategorized
                    <span
                      className="badge"
                      style={{
                        marginLeft: "auto",
                        background: "var(--warning-light)",
                        color: "var(--warning)",
                        border: "1px solid var(--warning)",
                      }}
                    >
                      {standalone.length}
                    </span>
                  </button>
                  {expandedCategories.has("__uncategorized__") && (
                    <div style={{ paddingLeft: 20, marginTop: 4 }}>
                      <p
                        style={{
                          fontSize: 12,
                          color: "var(--fg-muted)",
                          margin: "0 0 4px 24px",
                          fontStyle: "italic",
                        }}
                      >
                        Not filed into a category. File these into the Table of
                        Contents to keep the knowledge base organized.
                      </p>
                      <div style={{ paddingLeft: 24 }}>
                        {standalone.map(renderArticleRow)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
