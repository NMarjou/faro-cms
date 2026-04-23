"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Toc, TocCategory, TocSection, TocArticle } from "@/lib/types";
import { DragHandle } from "@/components/SortableList";

const SortableList = dynamic(() => import("@/components/SortableList"), { ssr: false });

export default function TocPage() {
  const [toc, setToc] = useState<Toc | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/toc")
      .then((r) => r.json())
      .then((data) => setToc(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const saveToc = async (updated: Toc) => {
    setSaving(true);
    try {
      const res = await fetch("/api/toc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toc: updated }),
      });
      if (res.ok) {
        setToc(updated);
        setMessage("TOC saved");
        setTimeout(() => setMessage(null), 2000);
      }
    } catch {
      setMessage("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const addCategory = () => {
    const name = prompt("Category name:");
    if (!name || !toc) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const updated: Toc = {
      categories: [
        ...toc.categories,
        { name, slug, description: "", sections: [] },
      ],
    };
    saveToc(updated);
  };

  const addSection = (categorySlug: string) => {
    const name = prompt("Section name:");
    if (!name || !toc) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const updated: Toc = {
      categories: toc.categories.map((cat) =>
        cat.slug === categorySlug
          ? { ...cat, sections: [...cat.sections, { name, slug, articles: [] }] }
          : cat
      ),
    };
    saveToc(updated);
  };

  const removeCategory = (categorySlug: string) => {
    if (!toc || !confirm("Delete this category and all its sections?")) return;
    const updated: Toc = {
      categories: toc.categories.filter((c) => c.slug !== categorySlug),
    };
    saveToc(updated);
  };

  const removeSection = (categorySlug: string, sectionSlug: string) => {
    if (!toc || !confirm("Delete this section and unlink its articles?")) return;
    const updated: Toc = {
      categories: toc.categories.map((cat) =>
        cat.slug === categorySlug
          ? {
              ...cat,
              sections: cat.sections.filter((s) => s.slug !== sectionSlug),
            }
          : cat
      ),
    };
    saveToc(updated);
  };

  const removeArticle = (
    categorySlug: string,
    sectionSlug: string,
    articleSlug: string
  ) => {
    if (!toc || !confirm("Remove this article from the TOC? (File is not deleted)")) return;
    const updated: Toc = {
      categories: toc.categories.map((cat) =>
        cat.slug === categorySlug
          ? {
              ...cat,
              sections: cat.sections.map((sec) =>
                sec.slug === sectionSlug
                  ? {
                      ...sec,
                      articles: sec.articles.filter(
                        (a) => a.slug !== articleSlug
                      ),
                    }
                  : sec
              ),
            }
          : cat
      ),
    };
    saveToc(updated);
  };

  const reorderArticles = (
    catSlug: string,
    secSlug: string,
    newArticles: { id: string }[]
  ) => {
    if (!toc) return;
    const updated: Toc = {
      categories: toc.categories.map((cat) =>
        cat.slug === catSlug
          ? {
              ...cat,
              sections: cat.sections.map((sec) => {
                if (sec.slug !== secSlug) return sec;
                // Rebuild articles array in new order
                const articleMap = new Map(sec.articles.map((a) => [a.slug, a]));
                const articles = newArticles
                  .map((item) => articleMap.get(item.id))
                  .filter(Boolean) as TocArticle[];
                return { ...sec, articles };
              }),
            }
          : cat
      ),
    };
    saveToc(updated);
  };

  return (
    <>
      <header className="main-header">
        <h1>Table of Contents</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {message && (
            <span style={{ fontSize: 13, color: "var(--success)" }}>
              {message}
            </span>
          )}
          <button onClick={addCategory} className="btn btn-primary">
            Add Category
          </button>
        </div>
      </header>
      <div className="main-body">
        {loading && <p>Loading...</p>}
        {toc && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {toc.categories.map((cat: TocCategory) => (
              <div key={cat.slug} className="card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <h2 style={{ fontSize: 18 }}>{cat.name}</h2>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => addSection(cat.slug)}
                      className="btn btn-sm"
                    >
                      Add Section
                    </button>
                    <button
                      onClick={() => removeCategory(cat.slug)}
                      className="btn btn-sm btn-danger"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--fg-muted)",
                    marginBottom: 12,
                  }}
                >
                  {cat.description || "No description"}
                </p>
                {cat.sections.map((sec: TocSection) => (
                  <div
                    key={sec.slug}
                    style={{
                      marginLeft: 20,
                      padding: "8px 0",
                      borderTop: "1px solid var(--border)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <h3 style={{ fontSize: 15, fontWeight: 500 }}>
                        {sec.name}
                        <span className="badge" style={{ marginLeft: 8 }}>
                          {sec.articles.length}
                        </span>
                      </h3>
                      <button
                        onClick={() => removeSection(cat.slug, sec.slug)}
                        className="btn btn-sm"
                        style={{ fontSize: 12 }}
                      >
                        Remove
                      </button>
                    </div>
                    {sec.articles.length > 0 && (
                      <div style={{ marginTop: 8, marginLeft: 16 }}>
                        <SortableList
                          items={sec.articles.map((a) => ({ ...a, id: a.slug }))}
                          onReorder={(newItems) => reorderArticles(cat.slug, sec.slug, newItems)}
                          renderItem={(art, handleProps) => (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "4px 0",
                                fontSize: 14,
                              }}
                            >
                              <DragHandle ref={handleProps.ref} {...handleProps.listeners} />
                              <span style={{ flex: 1 }}>{art.title}</span>
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "var(--fg-muted)",
                                  fontFamily: "var(--font-mono)",
                                }}
                              >
                                {art.file}
                              </span>
                              <button
                                onClick={() =>
                                  removeArticle(cat.slug, sec.slug, art.slug)
                                }
                                style={{
                                  border: "none",
                                  background: "none",
                                  color: "var(--danger)",
                                  cursor: "pointer",
                                  fontSize: 16,
                                  padding: "0 4px",
                                }}
                              >
                                x
                              </button>
                            </div>
                          )}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
