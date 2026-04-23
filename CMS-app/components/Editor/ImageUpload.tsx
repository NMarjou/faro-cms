"use client";

import { useState, useRef } from "react";

interface ImageUploadProps {
  onInsert: (src: string, alt: string) => void;
  onClose: () => void;
}

export default function ImageUpload({ onInsert, onClose }: ImageUploadProps) {
  const [tab, setTab] = useState<"upload" | "url">("upload");
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }
      const data = await res.json();
      onInsert(data.path, alt || file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Insert Image</h3>
          <button onClick={onClose} className="modal-close">x</button>
        </div>

        <div style={{ display: "flex", gap: 0, marginBottom: 16 }}>
          <button
            className={`tab-btn${tab === "upload" ? " active" : ""}`}
            onClick={() => setTab("upload")}
          >
            Upload
          </button>
          <button
            className={`tab-btn${tab === "url" ? " active" : ""}`}
            onClick={() => setTab("url")}
          >
            URL
          </button>
        </div>

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>
            Alt text
          </label>
          <input
            className="input"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="Image description"
          />
        </div>

        {tab === "upload" ? (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/svg+xml,image/jpeg,image/gif"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="btn btn-primary"
              disabled={uploading}
              style={{ width: "100%" }}
            >
              {uploading ? "Uploading..." : "Choose File"}
            </button>
            <p style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 8 }}>
              PNG, SVG, JPEG, GIF
            </p>
          </div>
        ) : (
          <div>
            <input
              className="input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              style={{ marginBottom: 8 }}
            />
            <button
              onClick={() => { if (url) onInsert(url, alt); }}
              className="btn btn-primary"
              disabled={!url}
              style={{ width: "100%" }}
            >
              Insert
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
