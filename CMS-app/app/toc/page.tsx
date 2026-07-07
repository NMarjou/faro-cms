"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import dynamic from "next/dynamic";
import type { Toc, TocCategory, TocSection, TocArticle } from "@/lib/types";
import Icon from "@/components/Icon";
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

/** A place an article can live: a section (category + slug chain) or the
 *  standalone/uncategorized bucket. */
type ArticleTarget = { catSlug: string; chain: string[] } | "uncategorized";

/** Encode a target for a <select> value / current-location comparison. */
const targetKey = (t: ArticleTarget): string =>
  t === "uncategorized" ? "uncategorized" : JSON.stringify({ catSlug: t.catSlug, chain: t.chain });

/** Pull an article out of wherever it lives (first slug match), returning the
 *  trimmed TOC and the removed entry. */
function extractArticle(toc: Toc, slug: string): { toc: Toc; entry: TocArticle | null } {
  let entry: TocArticle | null = null;
  const pull = (arts: TocArticle[]) =>
    arts.filter((a) => {
      if (!entry && a.slug === slug) { entry = a; return false; }
      return true;
    });
  const walk = (secs: TocSection[]): TocSection[] =>
    secs.map((s) => ({
      ...s,
      articles: pull(s.articles),
      ...(s.subsections ? { subsections: walk(s.subsections) } : {}),
    }));
  const categories = toc.categories.map((c) => ({ ...c, sections: walk(c.sections) }));
  const articles = toc.articles ? pull(toc.articles) : toc.articles;
  return { toc: { ...toc, categories, articles }, entry };
}

/** Append an article entry into a target location. */
function insertArticle(toc: Toc, target: ArticleTarget, entry: TocArticle): Toc {
  if (target === "uncategorized") {
    return { ...toc, articles: [...(toc.articles ?? []), entry] };
  }
  return {
    ...toc,
    categories: toc.categories.map((c) =>
      c.slug === target.catSlug
        ? { ...c, sections: mapSections(c.sections, target.chain, (s) => ({ ...s, articles: [...s.articles, entry] })) }
        : c
    ),
  };
}

/** Insert an article into a target location, before `beforeSlug` if given
 *  (else appended). Used by drag-and-drop to drop at a specific position. */
function insertArticleAt(toc: Toc, target: ArticleTarget, entry: TocArticle, beforeSlug?: string): Toc {
  const place = (arts: TocArticle[]) => {
    if (!beforeSlug) return [...arts, entry];
    const i = arts.findIndex((a) => a.slug === beforeSlug);
    return i === -1 ? [...arts, entry] : [...arts.slice(0, i), entry, ...arts.slice(i)];
  };
  if (target === "uncategorized") return { ...toc, articles: place(toc.articles ?? []) };
  return {
    ...toc,
    categories: toc.categories.map((c) =>
      c.slug === target.catSlug
        ? { ...c, sections: mapSections(c.sections, target.chain, (s) => ({ ...s, articles: place(s.articles) })) }
        : c
    ),
  };
}

/** Flatten every section into a pick-list of move targets, breadcrumb-labeled. */
function sectionTargets(toc: Toc): { catSlug: string; chain: string[]; label: string }[] {
  const out: { catSlug: string; chain: string[]; label: string }[] = [];
  for (const cat of toc.categories) {
    const walk = (secs: TocSection[], slugTrail: string[], nameTrail: string[]) => {
      for (const s of secs) {
        const chain = [...slugTrail, s.slug];
        out.push({ catSlug: cat.slug, chain, label: [cat.name, ...nameTrail, s.name].join(" › ") });
        if (s.subsections) walk(s.subsections, chain, [...nameTrail, s.name]);
      }
    };
    walk(cat.sections, [], []);
  }
  return out;
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
  const reorderSections = (catSlug: string, parentChain: string[], newItems: { id: string }[]) => {
    const ids = newItems.map((i) => i.id);
    if (parentChain.length === 0) {
      updateCategory(catSlug, (c) => ({ ...c, sections: reorderBySlug(c.sections, ids) }));
    } else {
      updateSection(catSlug, parentChain, (s) => ({ ...s, subsections: reorderBySlug(s.subsections ?? [], ids) }));
    }
  };

  // ── Article ops ──
  const removeArticleFrom = (loc: ArticleTarget, articleSlug: string) => {
    if (!toc || !confirm("Remove this article from the TOC? (File is not deleted)")) return;
    if (loc === "uncategorized") {
      saveToc({ ...toc, articles: (toc.articles ?? []).filter((a) => a.slug !== articleSlug) });
    } else {
      updateSection(loc.catSlug, loc.chain, (s) => ({ ...s, articles: s.articles.filter((a) => a.slug !== articleSlug) }));
    }
  };
  /** Relocate an article to a different section (or to uncategorized). */
  const moveArticle = (articleSlug: string, target: ArticleTarget) => {
    if (!toc) return;
    const { toc: without, entry } = extractArticle(toc, articleSlug);
    if (entry) saveToc(insertArticle(without, target, entry));
  };

  // ── Drag-and-drop (native HTML5) for moving/reordering articles across
  // sections. dnd-kit can't span the article lists (they're nested inside the
  // section/category sortables, and dnd-kit binds to the nearest context), so
  // articles use HTML5 DnD: rows are draggable, each container is a drop zone.
  const [dragSlug, setDragSlug] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const onArticleDragStart = (e: React.DragEvent, slug: string) => {
    e.dataTransfer.setData("text/x-toc-article", slug);
    e.dataTransfer.effectAllowed = "move";
    setDragSlug(slug);
  };
  const endDrag = () => { setDragSlug(null); setDragOverKey(null); };
  /** Drop `slug` into `target`, before `beforeSlug` (a row) or appended. */
  const dropArticle = (e: React.DragEvent, target: ArticleTarget, beforeSlug?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const slug = e.dataTransfer.getData("text/x-toc-article");
    endDrag();
    if (!toc || !slug || slug === beforeSlug) return;
    const { toc: without, entry } = extractArticle(toc, slug);
    if (entry) saveToc(insertArticleAt(without, target, entry, beforeSlug));
  };

  if (loaded && role === "contributor") {
    return <TechWriterBlocked title="Table of Contents" />;
  }

  const targets = toc ? sectionTargets(toc) : [];

  // ── One draggable article row: grab cue, title, path, Move-to picker, remove.
  // Dropping another row here inserts before it (reorder / cross-section place). ──
  const renderArticleRow = (art: TocArticle, target: ArticleTarget) => {
    const currentKey = targetKey(target);
    return (
      <div
        key={art.slug}
        draggable
        onDragStart={(e) => onArticleDragStart(e, art.slug)}
        onDragEnd={endDrag}
        onDragOver={(e) => { if (dragSlug && dragSlug !== art.slug) { e.preventDefault(); e.stopPropagation(); if (dragOverKey !== currentKey) setDragOverKey(currentKey); } }}
        onDrop={(e) => dropArticle(e, target, art.slug)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 14, cursor: "grab", opacity: dragSlug === art.slug ? 0.4 : 1 }}
      >
        <span className="drag-handle" style={{ color: "var(--fg-muted)" }}><Icon name="dots-six-vertical" size={14} /></span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art.title}</span>
        <span style={{ fontSize: 12, color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}>{art.file}</span>
        <select
          className="input"
          value=""
          title="Move to another section"
          onChange={(e) => {
            const v = e.target.value;
            if (v) moveArticle(art.slug, v === "uncategorized" ? "uncategorized" : (JSON.parse(v) as ArticleTarget));
          }}
          style={{ fontSize: 12, padding: "2px 6px", width: "auto", cursor: "pointer" }}
        >
          <option value="">Move to…</option>
          {targets
            .filter((t) => targetKey({ catSlug: t.catSlug, chain: t.chain }) !== currentKey)
            .map((t) => (
              <option key={t.catSlug + "/" + t.chain.join("/")} value={JSON.stringify({ catSlug: t.catSlug, chain: t.chain })}>
                {t.label}
              </option>
            ))}
          {currentKey !== "uncategorized" && <option value="uncategorized">Uncategorized</option>}
        </select>
        <button
          onClick={() => removeArticleFrom(target, art.slug)}
          style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer", fontSize: 16, padding: "0 4px" }}
          title="Remove from TOC"
        >
          x
        </button>
      </div>
    );
  };

  /** A section/uncategorized article list that is also a drop zone. Renders
   *  nothing when empty and nothing is being dragged, so the tree stays clean;
   *  during a drag, empty zones appear so you can drop into them. */
  const renderArticleContainer = (articles: TocArticle[], target: ArticleTarget, marginLeft: number) => {
    if (articles.length === 0 && !dragSlug) return null;
    const key = targetKey(target);
    const isOver = dragOverKey === key;
    return (
      <div
        onDragOver={(e) => { if (dragSlug) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; if (dragOverKey !== key) setDragOverKey(key); } }}
        onDrop={(e) => dropArticle(e, target)}
        style={{ marginTop: 6, marginLeft, minHeight: dragSlug ? 26 : undefined, padding: "2px 4px", borderRadius: 6, background: isOver ? "var(--accent-light)" : undefined, outline: isOver ? "1px dashed var(--accent)" : undefined }}
      >
        {articles.map((art) => renderArticleRow(art, target))}
        {articles.length === 0 && dragSlug && (
          <div style={{ fontSize: 12, color: "var(--fg-muted)", padding: "4px 8px" }}>Drop here</div>
        )}
      </div>
    );
  };

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
            {renderArticleContainer(sec.articles, { catSlug, chain }, 22)}
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
          <>
            {toc.articles && toc.articles.length > 0 && (
              <div className="card" style={{ marginBottom: 16, borderStyle: "dashed" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <h2 style={{ fontSize: 18 }}>Uncategorized</h2>
                  <span className="badge">{toc.articles.length}</span>
                </div>
                <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 8 }}>
                  Newly created articles land here. Use “Move to…” to file them under a section.
                </p>
                {renderArticleContainer(toc.articles, "uncategorized", 0)}
              </div>
            )}
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
          </>
        )}
      </div>
    </>
  );
}
