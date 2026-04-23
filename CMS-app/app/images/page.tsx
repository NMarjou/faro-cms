"use client";

import React, { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import { DragHandle } from "@/components/SortableList";

const SortableList = dynamic(() => import("@/components/SortableList"), { ssr: false });

interface ImageInfo {
  name: string;
  file: string;
  folder: string;
}

interface ImagesData {
  folders: string[];
  images: ImageInfo[];
}

export default function ImagesPage() {
  const [data, setData] = useState<ImagesData>({ folders: [], images: [] });
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [currentFolder, setCurrentFolder] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
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
    if (!confirm(`Delete image "${image.name}"?`)) return;
    setDeleting(image.file);
    try {
      await fetch("/api/content", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: image.file, message: `Delete image: ${image.name}` }) });
      loadImages();
    } catch (err) { console.error(err); } finally { setDeleting(null); }
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
          <span style={{ fontSize: 11, color: "var(--fg-muted)", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>{image.file.split("/").pop()}</span>
        </div>
        <button className="tree-add-btn tree-add-btn-hover" style={{ color: "var(--danger)", fontSize: 14 }} title="Delete image" disabled={deleting === image.file} onClick={() => deleteImage(image)}>
          {deleting === image.file ? "..." : "\u00d7"}
        </button>
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
