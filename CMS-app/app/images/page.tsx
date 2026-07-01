"use client";

import React, { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import { DragHandle } from "@/components/SortableList";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useCurrentProject } from "@/components/CurrentProjectProvider";
import { canManageImages, canDeleteImage } from "@/lib/permissions";
import TechWriterBlocked from "@/components/TechWriterBlocked";

const SortableList = dynamic(() => import("@/components/SortableList"), {
  ssr: false,
}) as typeof import("@/components/SortableList").default;

interface ImageInfo {
  name: string;
  file: string;
  folder: string;
  // false when this project has a local override of the shared image.
  shared: boolean;
  owner?: string;
  uploadedAt?: string;
}

interface ImagesData {
  folders: string[];
  images: ImageInfo[];
}

export default function ImagesPage() {
  const { user, role, loaded } = useCurrentUser();
  const { project, projects } = useCurrentProject();
  const [data, setData] = useState<ImagesData>({ folders: [], images: [] });
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [currentFolder, setCurrentFolder] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [overriding, setOverriding] = useState<string | null>(null);

  // Friendly name of the active project for override copy/badges.
  const projectLabel =
    projects.find((p) => p.slug === project)?.name || project || "this project";
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ImageInfo | null>(null);

  // Inline folder creation
  const [creatingFolder, setCreatingFolder] = useState<string | null>(null); // parent folder or null
  const [newFolderName, setNewFolderName] = useState("");
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadImages = () => {
    fetch("/api/images")
      .then((r) => r.json())
      .then((d: ImagesData) => {
        setData(d);
        setExpanded((prev) => {
          if (prev.size === 0 && d.folders.length > 0) return new Set(d.folders);
          return prev;
        });
      })
      .catch(() => setData({ folders: [], images: [] }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadImages(); }, []);
  useEffect(() => { if (creatingFolder !== null && folderInputRef.current) folderInputRef.current.focus(); }, [creatingFolder]);

  const toggle = (folder: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder); else next.add(folder);
      return next;
    });
  };

  const generateSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const cancelFolderCreation = () => { setCreatingFolder(null); setNewFolderName(""); };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) { cancelFolderCreation(); return; }
    const slug = generateSlug(name);
    const parent = creatingFolder || "";
    const folderPath = parent ? `${parent}/${slug}` : slug;
    await fetch("/api/content", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: `images/${folderPath}/.gitkeep`, content: "", message: `Create image folder: ${name}` }),
    });
    setExpanded((prev) => new Set([...prev, folderPath]));
    cancelFolderCreation();
    loadImages();
  };

  const handleUpload = async (files: FileList) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        if (currentFolder) formData.append("folder", currentFolder);
        if (user?.email) formData.append("owner", user.email);
        await fetch("/api/upload", { method: "POST", body: formData });
      }
      loadImages();
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteImage = async (image: ImageInfo) => {
    const msg = image.shared
      ? `Delete shared image "${image.name}"?\n\nThis image is shared — deleting it removes it from ALL projects.`
      : `Delete ${projectLabel}'s copy of "${image.name}"? The shared version is restored.`;
    if (!confirm(msg)) return;
    setDeleting(image.file);
    try {
      await fetch("/api/content", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: image.file, message: `Delete image: ${image.name}` }) });
      loadImages();
    } catch (err) { console.error(err); } finally { setDeleting(null); }
  };

  // "Make project-specific": fork the shared image into the current project.
  const makeProjectSpecific = async (image: ImageInfo) => {
    setOverriding(image.file);
    try {
      await fetch("/api/images/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: image.file }),
      });
      loadImages();
    } catch (err) { console.error(err); } finally { setOverriding(null); }
  };

  // "Revert to shared": drop this project's override, restoring the shared copy.
  const revertToShared = async (image: ImageInfo) => {
    if (!confirm(`Revert "${image.name}" to the shared version?\n\nThis discards ${projectLabel}'s copy.`)) return;
    setOverriding(image.file);
    try {
      await fetch(`/api/images/override?file=${encodeURIComponent(image.file)}`, { method: "DELETE" });
      loadImages();
    } catch (err) { console.error(err); } finally { setOverriding(null); }
  };

  const handleReorderImages = async (folder: string, newItems: { id: string }[]) => {
    const order = newItems.map((item) => item.id);
    setData((prev) => {
      const images = [...prev.images];
      const inFolder = images.filter((img) => img.folder === folder);
      const rest = images.filter((img) => img.folder !== folder);
      const orderMap = new Map(order.map((id, i) => [id, i]));
      inFolder.sort((a, b) => (orderMap.get(a.file) ?? 999) - (orderMap.get(b.file) ?? 999));
      return { ...prev, images: [...rest, ...inFolder] };
    });
    await fetch("/api/images", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, order }),
    });
  };

  const copyPath = (image: ImageInfo) => {
    navigator.clipboard.writeText(image.file);
    setCopied(image.file);
    setTimeout(() => setCopied(null), 1500);
  };

  // ── Icons ──
  const FolderIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
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

  // ── Breadcrumbs ──
  const breadcrumbSegments = currentFolder ? currentFolder.split("/") : [];
  const Breadcrumbs = () => (
    <div className="breadcrumbs">
      <button className={`breadcrumb-item${currentFolder === "" ? " active" : ""}`} onClick={() => setCurrentFolder("")}>
        Images
      </button>
      {breadcrumbSegments.map((seg, i) => {
        const path = breadcrumbSegments.slice(0, i + 1).join("/");
        const isLast = i === breadcrumbSegments.length - 1;
        return (
          <span key={path}>
            <span className="breadcrumb-sep">/</span>
            <button className={`breadcrumb-item${isLast ? " active" : ""}`} onClick={() => setCurrentFolder(path)}>{seg}</button>
          </span>
        );
      })}
    </div>
  );

  const InlineFolderInput = () => (
    <div className="tree-node">
      <div className="tree-branch" style={{ gap: 4 }}>
        <FolderIcon />
        <input ref={folderInputRef} value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") cancelFolderCreation(); }}
          onBlur={() => setTimeout(() => cancelFolderCreation(), 150)} placeholder="Folder name..." className="tree-inline-input" />
      </div>
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

  const getImagesInFolder = (folder: string) =>
    data.images.filter((img) => img.folder === folder);

  const renderImageItem = (image: ImageInfo & { id: string }, handleProps: { ref: React.Ref<HTMLElement>; listeners: Record<string, Function> | undefined }) => (
    <div className="tree-node">
      <div className="tree-branch-row">
        <DragHandle ref={handleProps.ref} {...handleProps.listeners} />
        <div className="tree-branch" style={{ flex: 1, cursor: "pointer" }} onClick={() => setViewing(image)} title="Click to preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/content?path=${encodeURIComponent(image.file)}&raw=1`} alt={image.name} className="tree-image-thumb"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <span className="tree-label">{image.name}</span>
          {image.owner && (
            <span
              style={{ fontSize: 11, color: "var(--fg-muted)", marginLeft: "auto" }}
              title={`Uploaded by ${image.owner}${image.uploadedAt ? ` on ${image.uploadedAt}` : ""}`}
            >
              {image.owner.split("@")[0]}
            </span>
          )}
          <span style={{ fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--font-mono)", marginLeft: image.owner ? 8 : "auto" }}>{image.file.split("/").pop()}</span>
        </div>
        {image.shared ? (
          <span className="badge" title="Shared across all projects" style={{ marginLeft: 8 }}>Shared</span>
        ) : (
          <span className="badge badge-accent" title={`Specific to ${projectLabel}`} style={{ marginLeft: 8 }}>{projectLabel}</span>
        )}
        {canManageImages(role) && (image.shared ? (
          <button className="tree-add-btn tree-add-btn-hover" title={`Make project-specific (copy into ${projectLabel})`} disabled={overriding === image.file} onClick={() => makeProjectSpecific(image)}>
            {overriding === image.file ? "..." : <ForkIcon />}
          </button>
        ) : (
          <button className="tree-add-btn tree-add-btn-hover" title="Revert to shared" disabled={overriding === image.file} onClick={() => revertToShared(image)}>
            {overriding === image.file ? "..." : <RevertIcon />}
          </button>
        ))}
        {canDeleteImage(role, image, user?.email) && (
          <button className="tree-add-btn tree-add-btn-hover" style={{ color: "var(--danger)", fontSize: 14 }} title="Delete image" disabled={deleting === image.file} onClick={() => deleteImage(image)}>
            {deleting === image.file ? "..." : "\u00d7"}
          </button>
        )}
      </div>
    </div>
  );

  const ImageSortableList = ({ folder }: { folder: string }) => {
    const items = getImagesInFolder(folder).map((img) => ({ ...img, id: img.file }));
    if (items.length === 0) return null;
    return (
      <SortableList
        items={items}
        onReorder={(newItems) => handleReorderImages(folder, newItems)}
        renderItem={renderImageItem}
      />
    );
  };

  const renderFolder = (folder: string) => {
    const isOpen = expanded.has(folder);
    const folderName = folder.includes("/") ? folder.split("/").pop()! : folder;
    const childFolders = getChildFolders(folder);
    const childImages = getImagesInFolder(folder);

    return (
      <div key={folder} className="tree-node">
        <div className="tree-branch-row">
          <div className={`tree-branch${isOpen ? " tree-expanded" : ""}`} role="button" tabIndex={0}
            onClick={() => { toggle(folder); setCurrentFolder(folder); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(folder); setCurrentFolder(folder); } }}>
            <FolderIcon />
            <span className="tree-label">{folderName}</span>
            <span className="tree-count">{childImages.length}</span>
            <span className={`tree-arrow${isOpen ? " open" : ""}`}>&#9654;</span>
          </div>
          <button className="tree-add-btn tree-add-btn-hover" title={`Upload to ${folderName}`}
            onClick={(e) => { e.stopPropagation(); setCurrentFolder(folder); setExpanded((prev) => new Set([...prev, folder])); fileInputRef.current?.click(); }}>+</button>
        </div>
        {isOpen && (
          <div className="tree-children">
            {childFolders.map((f) => renderFolder(f))}
            <ImageSortableList folder={folder} />
            {creatingFolder === folder && <InlineFolderInput />}
          </div>
        )}
      </div>
    );
  };

  const rootFolders = getChildFolders(currentFolder);
  const rootImages = getImagesInFolder(currentFolder);
  const isInSubfolder = currentFolder !== "";

  if (loaded && !canManageImages(role)) {
    return <TechWriterBlocked title="Images" />;
  }

  return (
    <>
      <header className="main-header">
        <h1>Images</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => { setCreatingFolder(currentFolder || ""); setNewFolderName(""); }}>New Folder</button>
          <button className="btn btn-primary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            {uploading ? "Uploading..." : "Upload Image"}
          </button>
          <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.svg" multiple style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.length) handleUpload(e.target.files); }} />
        </div>
      </header>
      <div className="main-body">
        <Breadcrumbs />

        {loading && <p>Loading...</p>}

        {!loading && (rootImages.length > 0 || rootFolders.length > 0) && (
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            {rootFolders.map((f) => renderFolder(f))}
            <ImageSortableList folder={currentFolder} />
            {creatingFolder === (currentFolder || "") && <InlineFolderInput />}
          </div>
        )}

        {!loading && rootImages.length === 0 && rootFolders.length === 0 && creatingFolder === null && (
          <div className="empty-state">
            <h3>{isInSubfolder ? "Empty folder" : "No images yet"}</h3>
            <p>{isInSubfolder ? "Upload images or create a subfolder here." : "Upload your first image using the button above."}</p>
          </div>
        )}

        {!loading && rootImages.length === 0 && rootFolders.length === 0 && creatingFolder !== null && (
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <InlineFolderInput />
          </div>
        )}
      </div>

      {/* Image viewer modal */}
      {viewing && (
        <div className="image-viewer-overlay" onClick={() => setViewing(null)}>
          <div className="image-viewer" onClick={(e) => e.stopPropagation()}>
            <div className="image-viewer-header">
              <span style={{ fontWeight: 600, fontSize: 14 }}>{viewing.name}</span>
              <button onClick={() => setViewing(null)} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "var(--fg-muted)", lineHeight: 1 }}>&times;</button>
            </div>
            <div className="image-viewer-body">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/content?path=${encodeURIComponent(viewing.file)}&raw=1`}
                alt={viewing.name}
                style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }}
              />
            </div>
            <div className="image-viewer-footer">
              <span style={{ fontSize: 12, color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}>{viewing.file}</span>
              <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                {viewing.owner
                  ? `Owner: ${viewing.owner}${viewing.uploadedAt ? ` · ${viewing.uploadedAt}` : ""}`
                  : "Owner: unknown"}
              </span>
              <button className="btn btn-sm" onClick={() => { copyPath(viewing); }}>
                {copied === viewing.file ? "Copied!" : "Copy Path"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
