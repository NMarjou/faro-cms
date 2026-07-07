"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import dynamic from "next/dynamic";
import type { Toc, TocCategory, TocSection, TocArticle } from "@/lib/types";
import { DragHandle } from "@/components/SortableList";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import TechWriterBlocked from "@/components/TechWriterBlocked";

const SortableList = dynamic(() => import("@/components/SortableList"), {
  ssr: false,
}) as typeof import("@/components/SortableList").default;

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Reorder a slug-keyed list to match an ordered list of ids. */
function reorderBySlug<T extends { slug: string }>(list: T[], ids: string[]): T[] {
  const map = new Map(list.map((x) => [x.slug, x]));
  return ids.map((id) => map.get(id)).filter(Boolean) as T[];
}

/**
 * Apply `fn` to the section addressed by `chain` (a slug path relative to
 * `sections`), rebuilding the list immutably. `fn` returning null deletes it.
 * Recurses into `subsections`, so it handles arbitrary nesting.
 */
function mapSections(
  sections: TocSection[],
  chain: string[],
  fn: (sec: TocSection) => TocSection | null
): TocSection[] {
  if (chain.length === 0) return sections;
  const [head, ...rest] = chain;
  return sections.flatMap((sec) => {
    if (sec.slug !== head) return [sec];
    if (rest.length === 0) {
      const r = fn(sec);
      return r ? [r] : [];
    }
    return [{ ...sec, subsections: mapSections(sec.subsections ?? [], rest, fn) }];
  });
}

export default function TocPage() {
  const { role, loaded } = useCurrentUser();
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
    setToc(updated); // optimistic — keeps the tree responsive across rapid edits
    setSaving(true);
    try {
      const res = await fetch("/api/toc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toc: updated }),
      });
      setMessage(res.ok ? "TOC saved" : "Failed to save");
    } catch {
      setMessage("Failed to save");
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 2000);
    }
  };

  // ── Category ops ──
  const updateCategory = (catSlug: string, fn: (c: TocCategory) => TocCategory | null) => {
    if (!toc) return;
    const categories = toc.categories.flatMap((c) => {
      if (c.slug !== catSlug) return [c];
      const r = fn(c);
      return r ? [r] : [];
    });
    saveToc({ ...toc, categories });
  };

  const addCategory = () => {
    const name = prompt("Category name:")?.trim();
    if (!name || !toc) return;
    saveToc({ ...toc, categories: [...toc.categories, { name, slug: slugify(name), description: "", sections: [] }] });
  };
  const renameCategory = (cat: TocCategory) => {
    const name = prompt("Rename category:", cat.name)?.trim();
    if (name) updateCategory(cat.slug, (c) => ({ ...c, name }));
  };
  const removeCategory = (catSlug: string) => {
    if (confirm("Delete this category and all its sections?")) updateCategory(catSlug, () => null);
  };
  const reorderCategories = (newItems: { id: string }[]) => {
    if (toc) saveToc({ ...toc, categories: reorderBySlug(toc.categories, newItems.map((i) => i.id)) });
  };

  // ── Section ops (chain is the slug path to the section, within its category) ──
  const updateSection = (catSlug: string, chain: string[], fn: (s: TocSection) => TocSection | null) =>
    updateCategory(catSlug, (c) => ({ ...c, sections: mapSections(c.sections, chain, fn) }));

  const addSection = (catSlug: string) => {
    const name = prompt("Section name:")?.trim();
    if (name) updateCategory(catSlug, (c) => ({ ...c, sections: [...c.sections, { name, slug: slugify(name), articles: [] }] }));
  };
  const addSubsection = (catSlug: string, chain: string[]) => {
    const name = prompt("Subsection name:")?.trim();
    if (name) updateSection(catSlug, chain, (s) => ({ ...s, subsections: [...(s.subsections ?? []), { name, slug: slugify(name), articles: [] }] }));
  };
  const renameSection = (catSlug: string, chain: string[], current: string) => {
    const name = prompt("Rename section:", current)?.trim();
    if (name) updateSection(catSlug, chain, (s) => ({ ...s, name }));
  };
  const removeSection = (catSlug: string, chain: string[]) => {
    if (confirm("Delete this section and unlink its articles? (Files are not deleted)")) updateSection(catSlug, chain, () => null);
  };
  /** Reorder the sections that live directly under `parentChain` ([] = the
   *  category's top-level sections; otherwise the subsections of that section). */
  const reorderSections = (catSlug: string, parentChain: string[], newItems: { id: string }[]) => {
    const ids = newItems.map((i) => i.id);
    if (parentChain.length === 0) {
      updateCategory(catSlug, (c) => ({ ...c, sections: reorderBySlug(c.sections, ids) }));
    } else {
      updateSection(catSlug, parentChain, (s) => ({ ...s, subsections: reorderBySlug(s.subsections ?? [], ids) }));
    }
  };

  // ── Article ops ──
  const reorderArticles = (catSlug: string, chain: string[], newItems: { id: string }[]) =>
    updateSection(catSlug, chain, (s) => ({ ...s, articles: reorderBySlug(s.articles, newItems.map((i) => i.id)) }));
  const removeArticle = (catSlug: string, chain: string[], articleSlug: string) => {
    if (confirm("Remove this article from the TOC? (File is not deleted)")) {
      updateSection(catSlug, chain, (s) => ({ ...s, articles: s.articles.filter((a) => a.slug !== articleSlug) }));
    }
  };

  if (loaded && role === "contributor") {
    return <TechWriterBlocked title="Table of Contents" />;
  }

  // ── Recursive section renderer ──
  const renderSections = (catSlug: string, sections: TocSection[], parentChain: string[]) => (
    <SortableList
      items={sections.map((s) => ({ ...s, id: s.slug }))}
      onReorder={(items) => reorderSections(catSlug, parentChain, items)}
      renderItem={(sec, handleProps) => {
        const chain = [...parentChain, sec.slug];
        return (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DragHandle ref={handleProps.ref} {...handleProps.listeners} />
              <h3 style={{ fontSize: 15, fontWeight: 500, flex: 1 }}>
                {sec.name}
                <span className="badge" style={{ marginLeft: 8 }}>{sec.articles.length}</span>
              </h3>
              <button onClick={() => renameSection(catSlug, chain, sec.name)} className="btn btn-sm">Rename</button>
              <button onClick={() => addSubsection(catSlug, chain)} className="btn btn-sm">+ Subsection</button>
              <button onClick={() => removeSection(catSlug, chain)} className="btn btn-sm btn-danger">Remove</button>
            </div>
            {sec.articles.length > 0 && (
              <div style={{ marginTop: 6, marginLeft: 22 }}>
                <SortableList
                  items={sec.articles.map((a) => ({ ...a, id: a.slug }))}
                  onReorder={(items) => reorderArticles(catSlug, chain, items)}
                  renderItem={(art: TocArticle & { id: string }, ap) => (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 14 }}>
                      <DragHandle ref={ap.ref} {...ap.listeners} />
                      <span style={{ flex: 1 }}>{art.title}</span>
                      <span style={{ fontSize: 12, color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}>{art.file}</span>
                      <button
                        onClick={() => removeArticle(catSlug, chain, art.slug)}
                        style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer", fontSize: 16, padding: "0 4px" }}
                        title="Remove from TOC"
                      >
                        x
                      </button>
                    </div>
                  )}
                />
              </div>
            )}
            {sec.subsections && sec.subsections.length > 0 && (
              <div style={{ marginLeft: 22 }}>{renderSections(catSlug, sec.subsections, chain)}</div>
            )}
          </div>
        );
      }}
    />
  );

  return (
    <>
      <PageHeader title="Table of Contents">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {message && <span style={{ fontSize: 13, color: saving ? "var(--fg-muted)" : "var(--success)" }}>{message}</span>}
          <button onClick={addCategory} className="btn btn-primary">Add Category</button>
        </div>
      </PageHeader>
      <div className="main-body">
        {loading && <p>Loading...</p>}
        {toc && (
          <SortableList
            items={toc.categories.map((c) => ({ ...c, id: c.slug }))}
            onReorder={reorderCategories}
            renderItem={(cat, handleProps) => (
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <DragHandle ref={handleProps.ref} {...handleProps.listeners} />
                    <h2 style={{ fontSize: 18 }}>{cat.name}</h2>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button onClick={() => renameCategory(cat)} className="btn btn-sm">Rename</button>
                    <button onClick={() => addSection(cat.slug)} className="btn btn-sm">Add Section</button>
                    <button onClick={() => removeCategory(cat.slug)} className="btn btn-sm btn-danger">Delete</button>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 8 }}>{cat.description || "No description"}</p>
                {cat.sections.length > 0 && renderSections(cat.slug, cat.sections, [])}
              </div>
            )}
          />
        )}
      </div>
    </>
  );
}
