"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { DragHandle } from "@/components/SortableList";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useCurrentProject } from "@/components/CurrentProjectProvider";
import TechWriterBlocked from "@/components/TechWriterBlocked";

const SortableList = dynamic(() => import("@/components/SortableList"), {
  ssr: false,
}) as typeof import("@/components/SortableList").default;

interface SnippetInfo {
  name: string;
  file: string;
  folder: string;
  // false when this project has a local override of the shared snippet.
  shared: boolean;
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
  const { role, loaded } = useCurrentUser();
  const { project, projects } = useCurrentProject();
  const [data, setData] = useState<SnippetsData>({ folders: [], snippets: [] });
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [currentFolder, setCurrentFolder] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [overriding, setOverriding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Friendly name of the active project for override copy/badges.
  const projectLabel =
    projects.find((p) => p.slug === project)?.name || project || "this project";

  const flashError = (msg: string) => { setError(msg); setTimeout(() => setError(null), 5000); };
  // Surface a failed write instead of silently reloading an unchanged list.
  const errFrom = async (res: Response, fallback: string) =>
    (await res.json().catch(() => ({}))).error || fallback;

  const [creatingAt, setCreatingAt] = useState<CreatingAt>(null);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadSnippets = () => {
    fetch("/api/snippets?full=1")
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
    const isFolder = creatingAt.type === "folder";
    const slug = generateSlug(name);
    let body: Record<string, string>;
    if (creatingAt.type === "folder") {
      const folderPath = creatingAt.parent ? `${creatingAt.parent}/${slug}` : slug;
      body = { path: `snippets/${folderPath}/.gitkeep`, content: "", message: `Create snippet folder: ${name}` };
    } else {
      const folder = creatingAt.folder;
      const filePath = folder ? `snippets/${folder}/${slug}.html` : `snippets/${slug}.html`;
      body = { path: filePath, content: `<!--name:${name}-->\n<p>Snippet content here.</p>\n`, message: `Create snippet: ${name}` };
    }
    cancelCreation();
    try {
      const res = await fetch("/api/content", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { flashError(await errFrom(res, `Couldn't create ${isFolder ? "folder" : "snippet"}`)); return; }
      if (isFolder) {
        const folderPath = body.path.replace(/^snippets\//, "").replace(/\/\.gitkeep$/, "");
        setExpanded((prev) => new Set([...prev, folderPath]));
      }
      loadSnippets();
    } catch { flashError("Network error — please retry."); }
  };

  const deleteSnippet = async (snippet: SnippetInfo) => {
    // The × only appears on shared snippets (a project-specific one is removed
    // via "Revert to shared"), so this always deletes from the shared pool.
    if (!confirm(`Delete shared snippet "${snippet.name}"?\n\nThis snippet is shared — deleting it removes it from ALL projects.`)) return;
    setDeleting(snippet.file);
    try {
      const res = await fetch("/api/content", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: snippet.file, message: `Delete snippet: ${snippet.name}` }) });
      if (!res.ok) { flashError(await errFrom(res, "Couldn't delete snippet")); return; }
      loadSnippets();
    } catch { flashError("Network error — please retry."); } finally { setDeleting(null); }
  };

  // "Make project-specific": fork the shared snippet into the current project.
  const makeProjectSpecific = async (snippet: SnippetInfo) => {
    setOverriding(snippet.file);
    try {
      const res = await fetch("/api/snippets/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: snippet.file }),
      });
      if (!res.ok) { flashError(await errFrom(res, `Couldn't make "${snippet.name}" project-specific`)); return; }
      loadSnippets();
    } catch { flashError("Network error — please retry."); } finally { setOverriding(null); }
  };

  // "Revert to shared": drop this project's override, restoring the shared copy.
  const revertToShared = async (snippet: SnippetInfo) => {
    if (!confirm(`Revert "${snippet.name}" to the shared version?\n\nThis discards ${projectLabel}'s copy and any changes made to it.`)) return;
    setOverriding(snippet.file);
    try {
      const res = await fetch(`/api/snippets/override?file=${encodeURIComponent(snippet.file)}`, { method: "DELETE" });
      if (!res.ok) { flashError(await errFrom(res, `Couldn't revert "${snippet.name}"`)); return; }
      loadSnippets();
    } catch { flashError("Network error — please retry."); } finally { setOverriding(null); }
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
  const ForkIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
  const RevertIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
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
        {snippet.shared ? (
          <span className="badge" title="Shared across all projects" style={{ marginLeft: 8 }}>Shared</span>
        ) : (
          <span className="badge badge-accent" title={`Specific to ${projectLabel}`} style={{ marginLeft: 8 }}>{projectLabel}</span>
        )}
        {snippet.shared ? (
          <button className="tree-add-btn tree-add-btn-hover" title={`Make project-specific (copy into ${projectLabel})`} disabled={overriding === snippet.file} onClick={() => makeProjectSpecific(snippet)}>
            {overriding === snippet.file ? "..." : <ForkIcon />}
          </button>
        ) : (
          <button className="tree-add-btn tree-add-btn-hover" title={`Revert to shared (discard ${projectLabel}'s copy)`} disabled={overriding === snippet.file} onClick={() => revertToShared(snippet)}>
            {overriding === snippet.file ? "..." : <RevertIcon />}
          </button>
        )}
        {/* Delete is a shared-pool action; a project-specific snippet is removed
            via Revert (its shared twin always exists), so no \u00d7 on those rows. */}
        {snippet.shared && (
          <button className="tree-add-btn tree-add-btn-hover" style={{ color: "var(--danger)", fontSize: 14 }} title="Delete shared snippet" disabled={deleting === snippet.file} onClick={() => deleteSnippet(snippet)}>
            {deleting === snippet.file ? "..." : "\u00d7"}
          </button>
        )}
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

  if (loaded && role === "contributor") {
    return <TechWriterBlocked title="Snippets" />;
  }

  return (
    <>
      <header className="main-header">
        <h1>Snippets</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {error && <span style={{ fontSize: 13, color: "var(--danger)" }}>{error}</span>}
          <button className="btn" onClick={() => startCreating({ type: "folder", parent: currentFolder })}>New Folder</button>
          <button className="btn btn-primary" onClick={() => startCreating({ type: "snippet", folder: currentFolder })}>New Snippet</button>
        </div>
      </header>
      <div className="main-body">
        <Breadcrumbs />

        {!loading && (rootSnippets.length > 0 || rootFolders.length > 0) && (
          <p style={{ fontSize: 12, color: "var(--fg-muted)", margin: "0 0 10px" }}>
            New snippets are shared across all projects; use the fork icon to make one project-specific. Snippet order is shared across projects.
          </p>
        )}

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
