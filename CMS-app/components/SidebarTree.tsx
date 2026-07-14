"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Toc, TocCategory, TocSection, TocArticle } from "@/lib/types";
import { useTheme } from "./ThemeProvider";
import FaroLogo from "./FaroLogo";
import Icon from "./Icon";
import { useCurrentUser } from "./CurrentUserProvider";
import ProjectSwitcher from "./ProjectSwitcher";
import { isTechWriter, canManageImages } from "@/lib/permissions";
import { REVEAL_EVENT, type RevealTarget } from "./revealInExplorer";

type CreatingAt =
  | null
  | { type: "category" }
  | { type: "section"; categorySlug: string }
  | { type: "snippet-folder"; parent: string }
  | { type: "image-folder"; parent: string };

/** Section-chain expansion keys (root→leaf) for the article with this file,
 *  or null if not under this section list. Mirrors renderSection's key scheme. */
function findSectionChain(
  sections: TocSection[],
  file: string,
  catSlug: string,
  acc: string[]
): string[] | null {
  for (const s of sections) {
    const chain = [...acc, `sec:${catSlug}/${s.slug}`];
    if (s.articles.some((a) => a.file === file)) return chain;
    if (s.subsections) {
      const found = findSectionChain(s.subsections, file, catSlug, chain);
      if (found) return found;
    }
  }
  return null;
}

/** All expansion keys that must be open to reveal a target leaf in the tree. */
function ancestorKeys(target: RevealTarget, toc: Toc | null): string[] {
  if (target.type === "article") {
    for (const cat of toc?.categories ?? []) {
      const chain = findSectionChain(cat.sections, target.file, cat.slug, []);
      if (chain) return ["nav:articles", `cat:${cat.slug}`, ...chain];
    }
    return ["nav:articles"]; // top-level (uncategorized) article
  }
  // Snippets/images: open the nav section + each ancestor folder.
  const root = target.type === "snippet" ? "snippets" : "images";
  const prefix = target.type === "snippet" ? "snip-folder" : "img-folder";
  const parts = target.file.replace(new RegExp(`^${root}/`), "").split("/");
  parts.pop(); // drop the filename
  const keys = [`nav:${root}`];
  let acc = "";
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p;
    keys.push(`${prefix}:${acc}`);
  }
  return keys;
}

export default function SidebarTree() {
  const pathname = usePathname();
  const router = useRouter();
  const { role } = useCurrentUser();
  // Tech-writer-only tooling (structure editing, snippets, images, variables,
  // publish, import, QA, review queue, platform settings). Authors and
  // contributors both see the limited shell — authors create articles from the
  // Articles page, not the nav. Unknown/unloaded role → not a tech writer, so
  // the limited shell renders during the brief load rather than flashing tools.
  const techWriter = isTechWriter(role);
  // Images are available to authors too — they add images to articles they
  // write. Everything else under "tools" stays tech-writer only.
  const manageImages = canManageImages(role);

  // Review-queue badge — tech writers see a count of items needing their
  // attention across all articles (pending suggestions + awaiting sign-off).
  // Cheap GET; refreshed on identity change and via the same
  // `cms-identity-changed` custom event other surfaces listen for.
  const [reviewPending, setReviewPending] = useState(0);
  useEffect(() => {
    if (!techWriter) return;
    let cancelled = false;
    const fetchCount = () => {
      fetch("/api/suggestions")
        .then((r) => (r.ok ? r.json() : { totalPending: 0, totalSignoffs: 0 }))
        .then((d: { totalPending?: number; totalSignoffs?: number }) => {
          if (!cancelled) setReviewPending((d.totalPending || 0) + (d.totalSignoffs || 0));
        })
        .catch(() => {});
    };
    fetchCount();
    // Refresh when navigation happens (cheap signal that something may have
    // been accepted/rejected in the editor). The custom event is already
    // wired by CurrentUserProvider for identity changes; re-using it here.
    const handler = () => fetchCount();
    window.addEventListener("cms-identity-changed", handler);
    window.addEventListener("focus", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("cms-identity-changed", handler);
      window.removeEventListener("focus", handler);
    };
  }, [techWriter]);
  const [toc, setToc] = useState<Toc | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [viewingImage, setViewingImage] = useState<{ name: string; file: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);
  // The article/snippet currently open in the editor, derived from the URL
  // (/editor/<encoded file>) — articles open as full-page editor routes.
  const currentEditorFile =
    pathname && pathname.startsWith("/editor/")
      ? decodeURIComponent(pathname.slice("/editor/".length))
      : null;
  const { theme, toggle: toggleTheme } = useTheme();

  // Folder creation state
  const [creatingAt, setCreatingAt] = useState<CreatingAt>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  // Snippets, Images & Variables data for expandable trees
  const [snippetsData, setSnippetsData] = useState<{ folders: string[]; snippets: { name: string; file: string; folder: string }[] } | null>(null);
  const [imagesData, setImagesData] = useState<{ folders: string[]; images: { name: string; file: string; folder: string }[] } | null>(null);
  const [variablesData, setVariablesData] = useState<{ sets: { name: string; slug: string; variables: Record<string, string> }[] } | null>(null);
  const [conditionTags, setConditionTags] = useState<string[] | null>(null);
  const [conditionColors, setConditionColors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/toc")
      .then((r) => r.json())
      .then((data: Toc) => setToc(data))
      .catch(console.error);

    fetch("/api/snippets?full=1")
      .then((r) => r.json())
      .then((data) => setSnippetsData(data))
      .catch(() => {});

    fetch("/api/images")
      .then((r) => r.json())
      .then((data) => setImagesData(data))
      .catch(() => {});

    fetch("/api/variables?format=sets")
      .then((r) => r.json())
      .then((data) => setVariablesData(data))
      .catch(() => {});

    fetch("/api/conditions")
      .then((r) => r.json())
      .then((d) => {
        const parsed = d.content ? JSON.parse(d.content) : d;
        setConditionTags(parsed.tags || []);
        setConditionColors(parsed.colors || {});
      })
      .catch(() => setConditionTags([]));
  }, []);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Reveal-in-explorer: an object surface (editor, image viewer) fires
  // REVEAL_EVENT; expand the sidebar to the object's location, scroll its leaf
  // into view and flash it. tocRef keeps the (mounted-once) listener reading the
  // latest TOC without re-subscribing.
  const tocRef = useRef<Toc | null>(null);
  tocRef.current = toc;
  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent).detail as RevealTarget;
      if (!target?.type || !target?.file) return;
      setCollapsed(false);
      setExpanded((prev) => new Set([...prev, ...ancestorKeys(target, tocRef.current)]));
      const treeId = `${target.type}:${target.file}`;
      let tries = 0;
      const attempt = () => {
        const sel = `.sidebar-tree [data-tree-id="${treeId.replace(/["\\]/g, "\\$&")}"]`;
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          el.classList.add("search-highlight-flash");
          window.setTimeout(() => el.classList.remove("search-highlight-flash"), 2200);
        } else if (tries++ < 10) {
          // The tree data (or a just-expanded branch) may still be rendering.
          window.setTimeout(attempt, 120);
        }
      };
      window.setTimeout(attempt, 60);
    };
    window.addEventListener(REVEAL_EVENT, handler);
    return () => window.removeEventListener(REVEAL_EVENT, handler);
  }, []);

  // Auto-focus the inline input when creating a folder
  useEffect(() => {
    if (creatingAt && newFolderInputRef.current) {
      newFolderInputRef.current.focus();
    }
  }, [creatingAt]);

  const generateSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const saveToc = async (updated: Toc) => {
    try {
      const res = await fetch("/api/toc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toc: updated }),
      });
      if (res.ok) {
        setToc(updated);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  };

  const cancelCreation = () => {
    setCreatingAt(null);
    setNewFolderName("");
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || !creatingAt) {
      cancelCreation();
      return;
    }
    const slug = generateSlug(name);

    // Handle snippet/image folder creation
    if (creatingAt.type === "snippet-folder" || creatingAt.type === "image-folder") {
      const base = creatingAt.type === "snippet-folder" ? "snippets" : "images";
      const parent = (creatingAt as { parent: string }).parent;
      const folderPath = parent ? `${parent}/${slug}` : slug;
      await fetch("/api/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: `${base}/${folderPath}/.gitkeep`, content: "", message: `Create ${base} folder: ${name}` }),
      });
      const prefix = creatingAt.type === "snippet-folder" ? "snip-folder" : "img-folder";
      setExpanded((prev) => new Set([...prev, `${prefix}:${folderPath}`]));
      // Reload data
      if (creatingAt.type === "snippet-folder") {
        fetch("/api/snippets?full=1").then((r) => r.json()).then(setSnippetsData).catch(() => {});
      } else {
        fetch("/api/images").then((r) => r.json()).then(setImagesData).catch(() => {});
      }
      cancelCreation();
      return;
    }

    if (!toc) { cancelCreation(); return; }

    if (creatingAt.type === "category") {
      if (toc.categories.some((c) => c.slug === slug)) {
        cancelCreation();
        return;
      }
      const updated: Toc = {
        ...toc,
        categories: [
          ...toc.categories,
          { name, slug, description: "", sections: [] },
        ],
      };
      const ok = await saveToc(updated);
      if (ok) {
        setExpanded((prev) => new Set([...prev, `cat:${slug}`]));
      }
    } else if (creatingAt.type === "section") {
      const cat = toc.categories.find((c) => c.slug === creatingAt.categorySlug);
      if (cat?.sections.some((s) => s.slug === slug)) {
        cancelCreation();
        return;
      }
      const updated: Toc = {
        ...toc,
        categories: toc.categories.map((c) =>
          c.slug === creatingAt.categorySlug
            ? { ...c, sections: [...c.sections, { name, slug, articles: [] }] }
            : c
        ),
      };
      const ok = await saveToc(updated);
      if (ok) {
        setExpanded((prev) =>
          new Set([...prev, `sec:${creatingAt.categorySlug}/${slug}`])
        );
      }
    }
    cancelCreation();
  };

  const startCreating = (at: CreatingAt) => {
    setCreatingAt(at);
    setNewFolderName("");
  };

  const handleDragStart = (e: React.DragEvent, data: { type: string; name: string; file?: string }) => {
    e.dataTransfer.setData("application/cms-item", JSON.stringify(data));
    e.dataTransfer.effectAllowed = "copy";
  };

  const FolderIcon = () => (
    <Icon name="folder" size={15} style={{ color: "var(--accent-glow)" }} />
  );

  const InlineFolderInput = () => (
    <div className="tree-node">
      <div className="tree-branch" style={{ gap: 4 }}>
        <FolderIcon />
        <input
          ref={newFolderInputRef}
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateFolder();
            if (e.key === "Escape") cancelCreation();
          }}
          onBlur={() => setTimeout(() => cancelCreation(), 150)}
          placeholder="Folder name..."
          className="tree-inline-input"
        />
      </div>
    </div>
  );

  const renderArticle = (article: TocArticle) => {
    const active = article.file === currentEditorFile;
    return (
      <button
        key={article.slug}
        data-tree-id={`article:${article.file}`}
        onClick={() => router.push(`/editor/${encodeURIComponent(article.file)}`)}
        draggable
        onDragStart={(e) => handleDragStart(e, { type: "article", name: article.title, file: article.file })}
        className={`tree-leaf${active ? " tree-active" : ""}`}
        title={`${article.file} — Drag to editor to insert link`}
        style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%", fontFamily: "inherit" }}
      >
        {article.title}
      </button>
    );
  };

  const renderSection = (section: TocSection, catSlug: string) => {
    const key = `sec:${catSlug}/${section.slug}`;
    const isOpen = expanded.has(key);
    return (
      <div key={section.slug} className="tree-node">
        <button className={`tree-branch${isOpen ? " tree-expanded" : ""}`} onClick={() => toggle(key)}>
          <FolderIcon />
          <span className="tree-label">{section.name}</span>
          <span className="tree-count">{section.articles.length}</span>
          <span className={`tree-arrow${isOpen ? " open" : ""}`}><Icon name="caret-right" weight="bold" size={10} /></span>
        </button>
        {isOpen && (
          <div className="tree-children">
            {section.articles.map((a) => renderArticle(a))}
            {section.subsections?.map((sub) => renderSection(sub, catSlug))}
          </div>
        )}
      </div>
    );
  };

  const renderCategory = (category: TocCategory) => {
    const key = `cat:${category.slug}`;
    const isOpen = expanded.has(key);
    return (
      <div key={category.slug} className="tree-node">
        <div className="tree-branch-row">
          <div
            className={`tree-branch tree-category${isOpen ? " tree-expanded" : ""}`}
            role="button"
            tabIndex={0}
            title={category.description || category.name}
            onClick={() => toggle(key)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(key); } }}
          >
            {category.icon ? <Icon name={category.icon} size={14} /> : <FolderIcon />}
            <span className="tree-label">{category.name}</span>
            <span className={`tree-arrow${isOpen ? " open" : ""}`}><Icon name="caret-right" weight="bold" size={10} /></span>
          </div>
          {techWriter && (
            <button
              className="tree-add-btn tree-add-btn-hover"
              title={`New section in ${category.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((prev) => new Set([...prev, key]));
                startCreating({ type: "section", categorySlug: category.slug });
              }}
            >
              +
            </button>
          )}
        </div>
        {isOpen && (
          <div className="tree-children">
            {category.sections.map((s) => renderSection(s, category.slug))}
            {techWriter && creatingAt?.type === "section" && creatingAt.categorySlug === category.slug && (
              <InlineFolderInput />
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Snippet tree helpers ──
  const getSnippetChildFolders = (parent: string) => {
    if (!snippetsData) return [];
    const prefix = parent ? `${parent}/` : "";
    return snippetsData.folders.filter((f) => {
      const rel = parent ? f.replace(prefix, "") : f;
      return f.startsWith(prefix) && !rel.includes("/") && f !== parent;
    });
  };

  const getSnippetsInFolder = (folder: string) =>
    snippetsData?.snippets.filter((s) => s.folder === folder) || [];

  const renderSnippetLeaf = (snippet: { name: string; file: string }) => {
    const active = snippet.file === currentEditorFile;
    return (
      <button
        key={snippet.file}
        data-tree-id={`snippet:${snippet.file}`}
        onClick={() => router.push(`/editor/${encodeURIComponent(snippet.file)}`)}
        draggable
        onDragStart={(e) => handleDragStart(e, { type: "snippet", name: snippet.name, file: snippet.file })}
        className={`tree-leaf${active ? " tree-active" : ""}`}
        title={snippet.file}
        style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%", fontFamily: "inherit" }}
      >
        {snippet.name}
      </button>
    );
  };

  const renderSnippetFolder = (folder: string): React.ReactNode => {
    const key = `snip-folder:${folder}`;
    const isOpen = expanded.has(key);
    const folderName = folder.includes("/") ? folder.split("/").pop()! : folder;
    const childFolders = getSnippetChildFolders(folder);
    const childSnippets = getSnippetsInFolder(folder);
    return (
      <div key={folder} className="tree-node">
        <div className="tree-branch-row">
          <button className={`tree-branch${isOpen ? " tree-expanded" : ""}`} onClick={() => toggle(key)} style={{ flex: 1 }}>
            <FolderIcon />
            <span className="tree-label">{folderName}</span>
            <span className="tree-count">{childSnippets.length}</span>
            <span className={`tree-arrow${isOpen ? " open" : ""}`}><Icon name="caret-right" weight="bold" size={10} /></span>
          </button>
          <button className="tree-add-btn tree-add-btn-hover" title={`New folder in ${folderName}`}
            onClick={(e) => { e.stopPropagation(); setExpanded((prev) => new Set([...prev, key])); startCreating({ type: "snippet-folder", parent: folder }); }}>+</button>
        </div>
        {isOpen && (
          <div className="tree-children">
            {childFolders.map((f) => renderSnippetFolder(f))}
            {childSnippets.map((s) => renderSnippetLeaf(s))}
            {creatingAt?.type === "snippet-folder" && (creatingAt as { parent: string }).parent === folder && <InlineFolderInput />}
          </div>
        )}
      </div>
    );
  };

  // ── Image tree helpers ──
  const getImageChildFolders = (parent: string) => {
    if (!imagesData) return [];
    const prefix = parent ? `${parent}/` : "";
    return imagesData.folders.filter((f) => {
      const rel = parent ? f.replace(prefix, "") : f;
      return f.startsWith(prefix) && !rel.includes("/") && f !== parent;
    });
  };

  const getImagesInFolder = (folder: string) =>
    imagesData?.images.filter((img) => img.folder === folder) || [];

  const renderImageLeaf = (image: { name: string; file: string }) => (
    <button
      key={image.file}
      data-tree-id={`image:${image.file}`}
      onDoubleClick={() => setViewingImage(image)}
      draggable
      onDragStart={(e) => handleDragStart(e, { type: "image", name: image.name, file: image.file })}
      className="tree-leaf"
      title={`Double-click to preview — Drag to insert — ${image.file}`}
      style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%", fontFamily: "inherit" }}
    >
      {image.name}
    </button>
  );

  const renderImageFolder = (folder: string): React.ReactNode => {
    const key = `img-folder:${folder}`;
    const isOpen = expanded.has(key);
    const folderName = folder.includes("/") ? folder.split("/").pop()! : folder;
    const childFolders = getImageChildFolders(folder);
    const childImages = getImagesInFolder(folder);
    return (
      <div key={folder} className="tree-node">
        <div className="tree-branch-row">
          <button className={`tree-branch${isOpen ? " tree-expanded" : ""}`} onClick={() => toggle(key)} style={{ flex: 1 }}>
            <FolderIcon />
            <span className="tree-label">{folderName}</span>
            <span className="tree-count">{childImages.length}</span>
            <span className={`tree-arrow${isOpen ? " open" : ""}`}><Icon name="caret-right" weight="bold" size={10} /></span>
          </button>
          <button className="tree-add-btn tree-add-btn-hover" title={`New folder in ${folderName}`}
            onClick={(e) => { e.stopPropagation(); setExpanded((prev) => new Set([...prev, key])); startCreating({ type: "image-folder", parent: folder }); }}>+</button>
        </div>
        {isOpen && (
          <div className="tree-children">
            {childFolders.map((f) => renderImageFolder(f))}
            {childImages.map((img) => renderImageLeaf(img))}
            {creatingAt?.type === "image-folder" && (creatingAt as { parent: string }).parent === folder && <InlineFolderInput />}
          </div>
        )}
      </div>
    );
  };

  // Close create menu on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setShowCreateMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (collapsed) {
    // Icon-only nav for the collapsed rail. Same role-gating as the expanded
    // sidebar so a contributor sees the same shortened set, just compact.
    const navItem = (href: string, icon: string, label: string, isActive: boolean) => (
      <Link
        key={href}
        href={href}
        title={label}
        className={`sidebar-collapsed-link${isActive ? " active" : ""}`}
      >
        <Icon name={icon} size={16} />
      </Link>
    );
    const articlesActive = !!pathname?.startsWith("/articles") || !!pathname?.startsWith("/editor");
    return (
      <aside className="sidebar sidebar-collapsed">
        <div style={{ padding: "12px 0 8px", display: "flex", justifyContent: "center", cursor: "pointer" }} onClick={() => setCollapsed(false)} title="Expand sidebar">
          <FaroLogo size={24} showWordmark={false} />
        </div>
        <nav style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, marginTop: 8, flex: 1, overflow: "hidden auto", width: "100%" }}>
          {navItem("/", "squares-four", "Dashboard", pathname === "/")}
          {navItem("/articles", "file-text", "Articles", articlesActive)}
          {techWriter && navItem("/snippets", "scissors", "Snippets", pathname === "/snippets")}
          {manageImages && navItem("/images", "image-square", "Images", pathname === "/images")}
          {techWriter && (
            <>
              {navItem("/variables", "brackets-curly", "Variables", pathname === "/variables")}
              {navItem("/toc", "list", "TOCs", pathname === "/toc")}
            </>
          )}
          {navItem("/glossary", "book-open", "Glossary", pathname === "/glossary")}
          {techWriter && (
            <>
              {navItem("/publish", "cloud-arrow-up", "Publish", pathname === "/publish")}
              {navItem("/import", "download-simple", "Import", pathname === "/import")}
              {navItem("/link-mapper", "link", "Link Mapper", pathname === "/link-mapper")}
              {navItem("/qa", "check-circle", "QA", pathname === "/qa")}
              {navItem("/review", "git-pull-request", `Review Queue${reviewPending ? ` (${reviewPending})` : ""}`, pathname === "/review")}
            </>
          )}
          {navItem("/settings", "user", "User Settings", pathname === "/settings")}
          {techWriter && navItem("/settings/platform", "gear", "Platform Settings", pathname === "/settings/platform")}
        </nav>
        <button
          onClick={() => setCollapsed(false)}
          className="sidebar-expand-btn"
          title="Expand sidebar"
          style={{ marginTop: 8 }}
        >
          <Icon name="sidebar-simple" size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <FaroLogo size={36} />
        {techWriter && (
        <div ref={createMenuRef} style={{ position: "relative", marginLeft: "auto" }}>
          <button
            onClick={() => setShowCreateMenu((p) => !p)}
            className="create-menu-btn"
            title="Create new..."
          >
            +
          </button>
          {showCreateMenu && (
            <div className="create-menu-dropdown">
              <button
                onClick={() => { setShowCreateMenu(false); router.push("/articles/new"); }}
                className="create-menu-item"
              >
                Article
              </button>
              <button
                onClick={() => { setShowCreateMenu(false); router.push("/snippets"); }}
                className="create-menu-item"
              >
                Snippet
              </button>
              <button
                onClick={() => { setShowCreateMenu(false); router.push("/variables"); }}
                className="create-menu-item"
              >
                Variable Set
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Project switcher — scopes all content to the selected project. */}
      <ProjectSwitcher />

      <div className="sidebar-tree">
        {/* Dashboard */}
        <Link href="/" className={`tree-nav-link${pathname === "/" ? " active" : ""}`}>
          <Icon name="squares-four" />
          Dashboard
        </Link>

        {/* CONTENT section. Articles is visible to everyone (contributors
            get a read-only view); the rest are tech-writer only. */}
        <div className="tree-section-label">CONTENT</div>

        {/* Articles — expandable with article tree inside */}
        <div className="tree-node">
          <div className="tree-branch-row">
            <Link href="/articles" className={`tree-nav-link${pathname?.startsWith("/articles") || pathname?.startsWith("/editor") ? " active" : ""}`} style={{ flex: 1 }}>
              <Icon name="file-text" />
              Articles
            </Link>
            {techWriter && (
              <button
                className="tree-add-btn tree-add-btn-hover"
                title="New category"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((prev) => new Set([...prev, "nav:articles"]));
                  startCreating({ type: "category" });
                }}
              >
                +
              </button>
            )}
            <button className="tree-expand-btn" onClick={() => toggle("nav:articles")} title="Expand articles">
              <span className={`tree-arrow${expanded.has("nav:articles") ? " open" : ""}`}><Icon name="caret-right" weight="bold" size={10} /></span>
            </button>
          </div>
          {expanded.has("nav:articles") && (
            <div className="tree-children">
              {toc ? (
                <>
                  {toc.categories.map((cat) => renderCategory(cat))}
                  {techWriter && creatingAt?.type === "category" && <InlineFolderInput />}
                  {toc.articles && toc.articles.length > 0 && (
                    <div className="tree-node">
                      <div className="tree-section-label" style={{ marginTop: 4, fontSize: 10 }}>
                        Uncategorized
                      </div>
                      <div className="tree-children" style={{ paddingLeft: 0 }}>
                        {toc.articles.map((a) => renderArticle(a))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ padding: "4px 16px", fontSize: 12, color: "var(--fg-muted)" }}>
                  Loading...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Snippets — tech writer only */}
        {techWriter && (
        <>

        {/* Snippets — expandable tree */}
        <div className="tree-node">
          <div className="tree-branch-row">
            <Link href="/snippets" className={`tree-nav-link${pathname === "/snippets" ? " active" : ""}`} style={{ flex: 1 }}>
              <Icon name="scissors" />
              Snippets
            </Link>
            <button className="tree-add-btn tree-add-btn-hover" title="New snippet folder"
              onClick={(e) => { e.stopPropagation(); setExpanded((prev) => new Set([...prev, "nav:snippets"])); startCreating({ type: "snippet-folder", parent: "" }); }}>+</button>
            <button className="tree-expand-btn" onClick={() => toggle("nav:snippets")} title="Expand snippets">
              <span className={`tree-arrow${expanded.has("nav:snippets") ? " open" : ""}`}><Icon name="caret-right" weight="bold" size={10} /></span>
            </button>
          </div>
          {expanded.has("nav:snippets") && (
            <div className="tree-children">
              {snippetsData ? (
                <>
                  {getSnippetChildFolders("").map((f) => renderSnippetFolder(f))}
                  {getSnippetsInFolder("").map((s) => renderSnippetLeaf(s))}
                  {creatingAt?.type === "snippet-folder" && (creatingAt as { parent: string }).parent === "" && <InlineFolderInput />}
                  {snippetsData.snippets.length === 0 && snippetsData.folders.length === 0 && !creatingAt && (
                    <Link href="/snippets" className="tree-leaf" style={{ fontSize: 12, color: "var(--fg-muted)", textDecoration: "none" }}>
                      Manage snippets...
                    </Link>
                  )}
                </>
              ) : (
                <div style={{ padding: "4px 16px", fontSize: 12, color: "var(--fg-muted)" }}>Loading...</div>
              )}
            </div>
          )}
        </div>
        </>
        )}

        {/* Images — expandable tree (tech writers + authors) */}
        {manageImages && (
        <div className="tree-node">
          <div className="tree-branch-row">
            <Link href="/images" className={`tree-nav-link${pathname === "/images" ? " active" : ""}`} style={{ flex: 1 }}>
              <Icon name="image-square" />
              Images
            </Link>
            <button className="tree-add-btn tree-add-btn-hover" title="New image folder"
              onClick={(e) => { e.stopPropagation(); setExpanded((prev) => new Set([...prev, "nav:images"])); startCreating({ type: "image-folder", parent: "" }); }}>+</button>
            <button className="tree-expand-btn" onClick={() => toggle("nav:images")} title="Expand images">
              <span className={`tree-arrow${expanded.has("nav:images") ? " open" : ""}`}><Icon name="caret-right" weight="bold" size={10} /></span>
            </button>
          </div>
          {expanded.has("nav:images") && (
            <div className="tree-children">
              {imagesData ? (
                <>
                  {getImageChildFolders("").map((f) => renderImageFolder(f))}
                  {getImagesInFolder("").map((img) => renderImageLeaf(img))}
                  {creatingAt?.type === "image-folder" && (creatingAt as { parent: string }).parent === "" && <InlineFolderInput />}
                  {imagesData.images.length === 0 && imagesData.folders.length === 0 && !creatingAt && (
                    <Link href="/images" className="tree-leaf" style={{ fontSize: 12, color: "var(--fg-muted)", textDecoration: "none" }}>
                      Manage images...
                    </Link>
                  )}
                </>
              ) : (
                <div style={{ padding: "4px 16px", fontSize: 12, color: "var(--fg-muted)" }}>Loading...</div>
              )}
            </div>
          )}
        </div>
        )}

        {/* Variables / TOCs — tech writer only */}
        {techWriter && (
        <>
        {/* Variables — expandable tree */}
        <div className="tree-node">
          <div className="tree-branch-row">
            <Link href="/variables" className={`tree-nav-link${pathname === "/variables" ? " active" : ""}`} style={{ flex: 1 }}>
              <Icon name="brackets-curly" />
              Variables
            </Link>
            <button className="tree-expand-btn" onClick={() => toggle("nav:variables")} title="Expand variables">
              <span className={`tree-arrow${expanded.has("nav:variables") ? " open" : ""}`}><Icon name="caret-right" weight="bold" size={10} /></span>
            </button>
          </div>
          {expanded.has("nav:variables") && (
            <div className="tree-children">
              {variablesData ? (
                <>
                  {variablesData.sets.map((set) => {
                    const setKey = `var-set:${set.slug}`;
                    const isSetOpen = expanded.has(setKey);
                    const entries = Object.entries(set.variables);
                    return (
                      <div key={set.slug} className="tree-node">
                        <button className={`tree-branch${isSetOpen ? " tree-expanded" : ""}`} onClick={() => toggle(setKey)}>
                          <FolderIcon />
                          <span className="tree-label">{set.name}</span>
                          <span className="tree-count">{entries.length}</span>
                          <span className={`tree-arrow${isSetOpen ? " open" : ""}`}><Icon name="caret-right" weight="bold" size={10} /></span>
                        </button>
                        {isSetOpen && (
                          <div className="tree-children">
                            {entries.map(([key, value]) => (
                              <button
                                key={key}
                                draggable
                                onDragStart={(e) => handleDragStart(e, { type: "variable", name: key })}
                                className="tree-leaf"
                                title={`${key} = ${value} — Drag to insert`}
                                style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%", fontFamily: "inherit" }}
                              >
                                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{key}</span>
                                <span style={{ color: "var(--fg-muted)", fontSize: 11, marginLeft: 6 }}>{value}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {variablesData.sets.length === 0 && (
                    <Link href="/variables" className="tree-leaf" style={{ fontSize: 12, color: "var(--fg-muted)", textDecoration: "none" }}>
                      Manage variables...
                    </Link>
                  )}
                </>
              ) : (
                <div style={{ padding: "4px 16px", fontSize: 12, color: "var(--fg-muted)" }}>Loading...</div>
              )}
            </div>
          )}
        </div>

        {/* TOCs */}
        <Link href="/toc" className={`tree-nav-link${pathname === "/toc" ? " active" : ""}`}>
          <Icon name="list" />
          TOCs
        </Link>
        </>
        )}

        {/* REFERENCE section */}
        <div className="tree-section-label">REFERENCE</div>

        <Link href="/glossary" className={`tree-nav-link${pathname === "/glossary" ? " active" : ""}`}>
          <Icon name="book-open" />
          Glossary
        </Link>

        {techWriter && (
          <Link href="/styles" className={`tree-nav-link${pathname === "/styles" ? " active" : ""}`}>
            <Icon name="palette" />
            Styles
          </Link>
        )}

        {/* TOOLS section */}
        <div className="tree-section-label">TOOLS</div>

        {techWriter && (
        <>
        <Link href="/publish" className={`tree-nav-link${pathname === "/publish" ? " active" : ""}`}>
          <Icon name="cloud-arrow-up" />
          Publish
        </Link>

        <Link href="/import" className={`tree-nav-link${pathname === "/import" ? " active" : ""}`}>
          <Icon name="download-simple" />
          Import
        </Link>

        <Link href="/link-mapper" className={`tree-nav-link${pathname === "/link-mapper" ? " active" : ""}`}>
          <Icon name="link" />
          Link Mapper
        </Link>

        <Link href="/qa" className={`tree-nav-link${pathname === "/qa" ? " active" : ""}`}>
          <Icon name="check-circle" />
          QA
        </Link>

        <Link href="/review" className={`tree-nav-link${pathname === "/review" ? " active" : ""}`}>
          <Icon name="git-pull-request" />
          Review Queue
          {reviewPending > 0 && (
            <span className="tree-nav-badge">{reviewPending}</span>
          )}
        </Link>
        </>
        )}

        <Link href="/settings" className={`tree-nav-link${pathname === "/settings" ? " active" : ""}`}>
          <Icon name="user" />
          User Settings
        </Link>

        {techWriter && (
        <Link href="/settings/platform" className={`tree-nav-link${pathname === "/settings/platform" ? " active" : ""}`}>
          <Icon name="gear" />
          Platform Settings
        </Link>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, position: "absolute", bottom: 12, right: 8, zIndex: 5 }}>
        <button
          onClick={toggleTheme}
          className="sidebar-collapse-btn"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          style={{ position: "static" }}
        >
          {theme === "dark" ? (
            <Icon name="sun" size={14} />
          ) : (
            <Icon name="moon" size={14} />
          )}
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="sidebar-collapse-btn"
          title="Collapse sidebar"
          style={{ position: "static" }}
        >
          <Icon name="sidebar-simple" size={18} />
        </button>
      </div>

      {/* Image viewer modal (triggered by double-click in sidebar tree) */}
      {viewingImage && (
        <div className="image-viewer-overlay" onClick={() => setViewingImage(null)}>
          <div className="image-viewer" onClick={(e) => e.stopPropagation()}>
            <div className="image-viewer-header">
              <span style={{ fontWeight: 600, fontSize: 14 }}>{viewingImage.name}</span>
              <button onClick={() => setViewingImage(null)} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "var(--fg-muted)", lineHeight: 1 }}>&times;</button>
            </div>
            <div className="image-viewer-body">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/content?path=${encodeURIComponent(viewingImage.file)}&raw=1`}
                alt={viewingImage.name}
                style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }}
              />
            </div>
            <div className="image-viewer-footer">
              <span style={{ fontSize: 12, color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}>{viewingImage.file}</span>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
