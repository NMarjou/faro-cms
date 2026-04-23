"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Toc, TocCategory, TocSection, TocArticle } from "@/lib/types";
import { useTabContext } from "./TabContext";
import { useTheme } from "./ThemeProvider";
import FaroLogo from "./FaroLogo";

type CreatingAt =
  | null
  | { type: "category" }
  | { type: "section"; categorySlug: string }
  | { type: "snippet-folder"; parent: string }
  | { type: "image-folder"; parent: string };

export default function SidebarTree() {
  const pathname = usePathname();
  const router = useRouter();
  const [toc, setToc] = useState<Toc | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [viewingImage, setViewingImage] = useState<{ name: string; file: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const { openTab, activeFile } = useTabContext();
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

    fetch("/api/snippets")
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

    fetch("/api/content?path=conditions.json")
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
        fetch("/api/snippets").then((r) => r.json()).then(setSnippetsData).catch(() => {});
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
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
    const active = article.file === activeFile;
    return (
      <button
        key={article.slug}
        onClick={() => openTab(article.file, article.title)}
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
          <span className={`tree-arrow${isOpen ? " open" : ""}`}>&#9654;</span>
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
            onClick={() => toggle(key)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(key); } }}
          >
            <FolderIcon />
            <span className="tree-label">{category.name}</span>
            <span className={`tree-arrow${isOpen ? " open" : ""}`}>&#9654;</span>
          </div>
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
        </div>
        {isOpen && (
          <div className="tree-children">
            {category.sections.map((s) => renderSection(s, category.slug))}
            {creatingAt?.type === "section" && creatingAt.categorySlug === category.slug && (
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
    const active = snippet.file === activeFile;
    return (
      <button
        key={snippet.file}
        onClick={() => openTab(snippet.file, snippet.name)}
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
            <span className={`tree-arrow${isOpen ? " open" : ""}`}>&#9654;</span>
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
            <span className={`tree-arrow${isOpen ? " open" : ""}`}>&#9654;</span>
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
    return (
      <aside className="sidebar sidebar-collapsed">
        <div style={{ padding: "12px 0 8px", cursor: "pointer" }} onClick={() => setCollapsed(false)} title="Expand sidebar">
          <FaroLogo size={24} />
        </div>
        <button
          onClick={() => setCollapsed(false)}
          className="sidebar-expand-btn"
          title="Expand sidebar"
          style={{ marginTop: "auto" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
            <polyline points="12 8 15 12 12 16" />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <FaroLogo size={22} />
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: 22, letterSpacing: "0.03em" }}>Faro</span>
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
      </div>

      <div className="sidebar-tree">
        {/* Dashboard */}
        <Link href="/" className={`tree-nav-link${pathname === "/" ? " active" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          Dashboard
        </Link>

        {/* CONTENT section */}
        <div className="tree-section-label">CONTENT</div>

        {/* Articles — expandable with article tree inside */}
        <div className="tree-node">
          <div className="tree-branch-row">
            <Link href="/articles" className={`tree-nav-link${pathname?.startsWith("/articles") || pathname?.startsWith("/editor") ? " active" : ""}`} style={{ flex: 1 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Articles
            </Link>
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
            <button className="tree-expand-btn" onClick={() => toggle("nav:articles")} title="Expand articles">
              <span className={`tree-arrow${expanded.has("nav:articles") ? " open" : ""}`}>&#9654;</span>
            </button>
          </div>
          {expanded.has("nav:articles") && (
            <div className="tree-children">
              {toc ? (
                <>
                  {toc.categories.map((cat) => renderCategory(cat))}
                  {creatingAt?.type === "category" && <InlineFolderInput />}
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

        {/* Snippets — expandable tree */}
        <div className="tree-node">
          <div className="tree-branch-row">
            <Link href="/snippets" className={`tree-nav-link${pathname === "/snippets" ? " active" : ""}`} style={{ flex: 1 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z" />
                <polyline points="16 3 16 8 21 8" />
              </svg>
              Snippets
            </Link>
            <button className="tree-add-btn tree-add-btn-hover" title="New snippet folder"
              onClick={(e) => { e.stopPropagation(); setExpanded((prev) => new Set([...prev, "nav:snippets"])); startCreating({ type: "snippet-folder", parent: "" }); }}>+</button>
            <button className="tree-expand-btn" onClick={() => toggle("nav:snippets")} title="Expand snippets">
              <span className={`tree-arrow${expanded.has("nav:snippets") ? " open" : ""}`}>&#9654;</span>
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

        {/* Images — expandable tree */}
        <div className="tree-node">
          <div className="tree-branch-row">
            <Link href="/images" className={`tree-nav-link${pathname === "/images" ? " active" : ""}`} style={{ flex: 1 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              Images
            </Link>
            <button className="tree-add-btn tree-add-btn-hover" title="New image folder"
              onClick={(e) => { e.stopPropagation(); setExpanded((prev) => new Set([...prev, "nav:images"])); startCreating({ type: "image-folder", parent: "" }); }}>+</button>
            <button className="tree-expand-btn" onClick={() => toggle("nav:images")} title="Expand images">
              <span className={`tree-arrow${expanded.has("nav:images") ? " open" : ""}`}>&#9654;</span>
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

        {/* Variables — expandable tree */}
        <div className="tree-node">
          <div className="tree-branch-row">
            <Link href="/variables" className={`tree-nav-link${pathname === "/variables" ? " active" : ""}`} style={{ flex: 1 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7V4h16v3" />
                <path d="M9 20h6" />
                <path d="M12 4v16" />
              </svg>
              Variables
            </Link>
            <button className="tree-expand-btn" onClick={() => toggle("nav:variables")} title="Expand variables">
              <span className={`tree-arrow${expanded.has("nav:variables") ? " open" : ""}`}>&#9654;</span>
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
                          <span className={`tree-arrow${isSetOpen ? " open" : ""}`}>&#9654;</span>
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          TOCs
        </Link>

        {/* REFERENCE section */}
        <div className="tree-section-label">REFERENCE</div>

        <Link href="/glossary" className={`tree-nav-link${pathname === "/glossary" ? " active" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          Glossary
        </Link>

        {/* TOOLS section */}
        <div className="tree-section-label">TOOLS</div>

        <Link href="/search" className={`tree-nav-link${pathname === "/search" ? " active" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Search
        </Link>

        <Link href="/publish" className={`tree-nav-link${pathname === "/publish" ? " active" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16" />
            <line x1="12" y1="12" x2="12" y2="21" />
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
          </svg>
          Publish
        </Link>

        <Link href="/import" className={`tree-nav-link${pathname === "/import" ? " active" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Import
        </Link>

        <Link href="/link-mapper" className={`tree-nav-link${pathname === "/link-mapper" ? " active" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          Link Mapper
        </Link>

        <Link href="/qa" className={`tree-nav-link${pathname === "/qa" ? " active" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          QA
        </Link>

        <Link href="/settings" className={`tree-nav-link${pathname === "/settings" ? " active" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          User Settings
        </Link>

        <Link href="/settings/platform" className={`tree-nav-link${pathname === "/settings/platform" ? " active" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Platform Settings
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, position: "absolute", bottom: 12, right: 8, zIndex: 5 }}>
        <button
          onClick={toggleTheme}
          className="sidebar-collapse-btn"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          style={{ position: "static" }}
        >
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="sidebar-collapse-btn"
          title="Collapse sidebar"
          style={{ position: "static" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
            <polyline points="15 8 12 12 15 16" />
          </svg>
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
