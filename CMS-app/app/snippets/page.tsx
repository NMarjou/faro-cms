"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { DragHandle } from "@/components/SortableList";

const SortableList = dynamic(() => import("@/components/SortableList"), { ssr: false });

interface SnippetInfo {
  name: string;
  file: string;
  folder: string;
}

interface SnippetsData {
  folders: string[];
  snippets: SnippetInfo[];
}

type CreatingAt =
  | null
  | { type: "folder"; parent: string }
  | { type: "snippet"; folder: string };

export default function SnippetsPage() {
  const [data, setData] = useState<SnippetsData>({ folders: [], snippets: [] });
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [currentFolder, setCurrentFolder] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const [creatingAt, setCreatingAt] = useState<CreatingAt>(null);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadSnippets = () => {
    fetch("/api/snippets")
      .then((r) => r.json())
      .then((d: SnippetsData) => {
        setData(d);
        setExpanded((prev) => {
          if (prev.size === 0 && d.folders.length > 0) return new Set(d.folders);
          return prev;
        });
      })
      .catch(() => setData({ folders: [], snippets: [] }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSnippets(); }, []);
  useEffect(() => { if (creatingAt && inputRef.current) inputRef.current.focus(); }, [creatingAt]);

  const toggle = (folder: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder); else next.add(folder);
      return next;
    });
  };

  const generateSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const cancelCreation = () => { setCreatingAt(null); setNewName(""); };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !creatingAt) { cancelCreation(); return; }
    if (creatingAt.type === "folder") {
      const slug = generateSlug(name);
      const folderPath = creatingAt.parent ? `${creatingAt.parent}/${slug}` : slug;
      await fetch("/api/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: `snippets/${folderPath}/.gitkeep`, content: "", message: `Create snippet folder: ${name}` }),
      });
      setExpanded((prev) => new Set([...prev, folderPath]));
      loadSnippets();
    } else {
      const slug = generateSlug(name);
      const folder = creatingAt.folder;
      const filePath = folder ? `snippets/${folder}/${slug}.html` : `snippets/${slug}.html`;
      await fetch("/api/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content: `<!--name:${name}-->\n<p>Snippet content here.</p>\n`, message: `Create snippet: ${name}` }),
      });
      loadSnippets();
    }
    cancelCreation();
  };

  const deleteSnippet = async (snippet: SnippetInfo) => {
    if (!confirm(`Delete snippet "${snippet.name}"?`)) return;
    setDeleting(snippet.file);
    try {
      await fetch("/api/content", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: snippet.file, message: `Delete snippet: ${snippet.name}` }) });
      loadSnippets();
    } catch (err) { console.error(err); } finally { setDeleting(null); }
  };

  const startCreating = (at: CreatingAt) => { setCreatingAt(at); setNewName(""); };

  const handleReorderSnippets = async (folder: string, newItems: { id: string }[]) => {
    // Optimistic update
    const order = newItems.map((item) => item.id);
    setData((prev) => {
      const snippets = [...prev.snippets];
      const inFolder = snippets.filter((s) => s.folder === folder);
      const rest = snippets.filter((s) => s.folder !== folder);
      const orderMap = new Map(order.map((id, i) => [id, i]));
      inFolder.sort((a, b) => (orderMap.get(a.file) ?? 999) - (orderMap.get(b.file) ?? 999));
      return { ...prev, snippets: [...rest, ...inFolder] };
    });
    // Persist
    await fetch("/api/snippets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, order }),
    });
  };

  // ── Icons ──
  const FolderIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
  const SnippetIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z" />
      <polyline points="16 3 16 8 21 8" />
    </svg>
  );

  const InlineInput = ({ placeholder }: { placeholder: string }) => (
    <div className="tree-node">
      <div className="tree-branch" style={{ gap: 4 }}>
        {creatingAt?.type === "folder" ? <FolderIcon /> : <SnippetIcon />}
        <input ref={inputRef} value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") cancelCreation(); }}
          onBlur={() => setTimeout(() => cancelCreation(), 150)} placeholder={placeholder} className="tree-inline-input" />
      </div>
    </div>
  );

  // ── Breadcrumbs ──
  const breadcrumbSegments = currentFolder ? currentFolder.split("/") : [];

  const Breadcrumbs = () => (
    <div className="breadcrumbs">
      <button className={`breadcrumb-item${currentFolder === "" ? " active" : ""}`} onClick={() => setCurrentFolder("")}>
        Snippets
      </button>
      {breadcrumbSegments.map((seg, i) => {
        const path = breadcrumbSegments.slice(0, i + 1).join("/");
        const isLast = i === breadcrumbSegments.length - 1;
        return (
          <span key={path}>
            <span className="breadcrumb-sep">/</span>
            <button className={`breadcrumb-item${isLast ? " active" : ""}`} onClick={() => setCurrentFolder(path)}>
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );

  // ── Tree helpers ──
  const getChildFolders = (parent: string) => {
    const prefix = parent ? `${parent}/` : "";
    return data.folders.filter((f) => {
      const rel = parent ? f.replace(prefix, "") : f;
      return f.startsWith(prefix) && !rel.includes("/") && f !== parent;
    });
  };

  const getSnippetsInFolder = (folder: string) =>
    data.snippets.filter((s) => s.folder === folder);

  const renderSnippetItem = (snippet: SnippetInfo & { id: string }, handleProps: { ref: React.Ref<HTMLElement>; listeners: Record<string, Function> | undefined }) => (
    <div className="tree-node">
      <div className="tree-branch-row">
        <DragHandle ref={handleProps.ref} {...handleProps.listeners} />
        <Link href={`/editor/${encodeURIComponent(snippet.file)}`} className="tree-branch" style={{ textDecoration: "none", color: "inherit", flex: 1 }}>
          <SnippetIcon />
          <span className="tree-label">{snippet.name}</span>
          <span style={{ fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>{snippet.file.split("/").pop()}</span>
        </Link>
        <button className="tree-add-btn tree-add-btn-hover" style={{ color: "var(--danger)", fontSize: 14 }} title="Delete snippet" disabled={deleting === snippet.file} onClick={() => deleteSnippet(snippet)}>
          {deleting === snippet.file ? "..." : "\u00d7"}
        </button>
      </div>
    </div>
  );

  const SnippetSortableList = ({ folder }: { folder: string }) => {
    const items = getSnippetsInFolder(folder).map((s) => ({ ...s, id: s.file }));
    if (items.length === 0) return null;
    return (
      <SortableList
        items={items}
        onReorder={(newItems) => handleReorderSnippets(folder, newItems)}
        renderItem={renderSnippetItem}
      />
    );
  };

  const renderFolder = (folder: string) => {
    const isOpen = expanded.has(folder);
    const folderName = folder.includes("/") ? folder.split("/").pop()! : folder;
    const childFolders = getChildFolders(folder);
    const childSnippets = getSnippetsInFolder(folder);

    return (
      <div key={folder} className="tree-node">
        <div className="tree-branch-row">
          <div className={`tree-branch${isOpen ? " tree-expanded" : ""}`} role="button" tabIndex={0}
            onClick={() => { toggle(folder); setCurrentFolder(folder); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(folder); setCurrentFolder(folder); } }}>
            <FolderIcon />
            <span className="tree-label">{folderName}</span>
            <span className="tree-count">{childSnippets.length}</span>
            <span className={`tree-arrow${isOpen ? " open" : ""}`}>&#9654;</span>
          </div>
          <button className="tree-add-btn tree-add-btn-hover" title={`New snippet in ${folderName}`}
            onClick={(e) => { e.stopPropagation(); setExpanded((prev) => new Set([...prev, folder])); startCreating({ type: "snippet", folder }); }}>+</button>
        </div>
        {isOpen && (
          <div className="tree-children">
            {childFolders.map((f) => renderFolder(f))}
            <SnippetSortableList folder={folder} />
            {creatingAt?.type === "snippet" && creatingAt.folder === folder && <InlineInput placeholder="Snippet name..." />}
            {creatingAt?.type === "folder" && creatingAt.parent === folder && <InlineInput placeholder="Folder name..." />}
          </div>
        )}
      </div>
    );
  };

  const rootFolders = getChildFolders(currentFolder);
  const rootSnippets = getSnippetsInFolder(currentFolder);
  // For breadcrumb navigation: when in a subfolder, show that folder's direct children
  const isInSubfolder = currentFolder !== "";

  return (
    <>
      <header className="main-header">
        <h1>Snippets</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => startCreating({ type: "folder", parent: currentFolder })}>New Folder</button>
          <button className="btn btn-primary" onClick={() => startCreating({ type: "snippet", folder: currentFolder })}>New Snippet</button>
        </div>
      </header>
      <div className="main-body">
        <Breadcrumbs />

        {loading && <p>Loading...</p>}

        {!loading && (rootSnippets.length > 0 || rootFolders.length > 0) && (
          <div className="snippet-tree" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            {rootFolders.map((f) => renderFolder(f))}
            <SnippetSortableList folder={currentFolder} />
            {creatingAt?.type === "snippet" && creatingAt.folder === currentFolder && <InlineInput placeholder="Snippet name..." />}
            {creatingAt?.type === "folder" && creatingAt.parent === currentFolder && <InlineInput placeholder="Folder name..." />}
          </div>
        )}

        {!loading && rootSnippets.length === 0 && rootFolders.length === 0 && !creatingAt && (
          <div className="empty-state">
            <h3>{isInSubfolder ? "Empty folder" : "No snippets yet"}</h3>
            <p>{isInSubfolder ? "Create a snippet or subfolder here." : "Create your first reusable content snippet using the button above."}</p>
          </div>
        )}

        {!loading && rootSnippets.length === 0 && rootFolders.length === 0 && creatingAt && (
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <InlineInput placeholder={creatingAt.type === "folder" ? "Folder name..." : "Snippet name..."} />
          </div>
        )}
      </div>
    </>
  );
}
