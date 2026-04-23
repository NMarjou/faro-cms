"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Toc, TocArticle } from "@/lib/types";

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
  const [stats, setStats] = useState<DashboardStats>({ articles: 0, categories: 0, snippets: 0, variables: 0 });
  const [recent, setRecent] = useState<RecentArticle[]>([]);
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
            recentArticles.push({ title: a.title, file: a.file, lastModified: a.lastModified });
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
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <>
      <header className="main-header">
        <h1>Dashboard</h1>
        <Link href="/articles/new" className="btn btn-primary">
          New Article
        </Link>
      </header>
      <div className="main-body">
        <div className="dashboard-stats">
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

        {/* Recent Articles */}
        <h2 style={{ marginBottom: 12 }}>Recent Articles</h2>
        {loading ? (
          <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>Loading...</p>
        ) : recent.length > 0 ? (
          <div className="card" style={{ marginBottom: 24, padding: 0, overflow: "hidden" }}>
            {recent.map((article, i) => (
              <Link
                key={article.file}
                href={`/editor/${encodeURIComponent(article.file)}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 16px",
                  textDecoration: "none",
                  color: "inherit",
                  borderTop: i > 0 ? "1px solid var(--border)" : undefined,
                  transition: "background 0.1s",
                }}
                className="recent-article-row"
              >
                <span style={{ fontWeight: 500, fontSize: 14 }}>{article.title}</span>
                <span style={{ fontSize: 12, color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}>
                  {article.lastModified || "No date"}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p style={{ color: "var(--fg-muted)", fontSize: 14, marginBottom: 24 }}>No articles yet.</p>
        )}

        <h2 style={{ marginBottom: 16 }}>Quick Actions</h2>
        <div className="grid-cards">
          <Link href="/articles/new" className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <h3>Create Article</h3>
            <p style={{ color: "var(--fg-muted)", fontSize: 14, marginTop: 4 }}>
              Write a new knowledge base article
            </p>
          </Link>
          <Link href="/toc" className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <h3>Manage TOC</h3>
            <p style={{ color: "var(--fg-muted)", fontSize: 14, marginTop: 4 }}>
              Organize navigation hierarchy
            </p>
          </Link>
          <Link href="/variables" className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <h3>Edit Variables</h3>
            <p style={{ color: "var(--fg-muted)", fontSize: 14, marginTop: 4 }}>
              Manage reusable text substitutions
            </p>
          </Link>
          <Link href="/snippets" className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <h3>Manage Snippets</h3>
            <p style={{ color: "var(--fg-muted)", fontSize: 14, marginTop: 4 }}>
              Reusable content blocks
            </p>
          </Link>
        </div>
      </div>
    </>
  );
}
