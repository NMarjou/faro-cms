"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NewArticlePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSlug(
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
    );
  }, [title]);

  const handleCreate = async () => {
    if (!title || !slug) {
      setError("Title is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const filePath = `${slug}.html`;
      const content = `<h1>${title}</h1>\n<p>Start writing here...</p>\n`;

      const res = await fetch("/api/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          content,
          message: `Create new article: ${title}`,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create article");
      }

      // Add to TOC as standalone article
      const tocRes = await fetch("/api/toc");
      if (tocRes.ok) {
        const toc = await tocRes.json();
        if (!toc.articles) toc.articles = [];
        toc.articles.push({
          title,
          file: filePath,
          slug,
          format: "html",
          createdDate: new Date().toISOString().split("T")[0],
          lastModified: new Date().toISOString().split("T")[0],
        });
        await fetch("/api/toc", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toc, message: `Add ${title} to TOC` }),
        });
      }

      router.push(`/editor/${encodeURIComponent(filePath)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="main-header">
        <h1>New Article</h1>
      </header>
      <div className="main-body">
        <div className="card" style={{ maxWidth: 500 }}>
          {error && (
            <div style={{ background: "var(--danger-light)", color: "var(--danger)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>
              {error}
            </div>
          )}

          <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 16 }}>
            Create a new article. You can organize it into a category and section later via the Table of Contents.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ fontSize: 14, fontWeight: 500, display: "block", marginBottom: 4 }}>Title</label>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Article title"
                autoFocus
              />
            </div>

            <div>
              <label style={{ fontSize: 14, fontWeight: 500, display: "block", marginBottom: 4 }}>Slug</label>
              <input
                className="input"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="article-slug"
              />
              <p style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 4 }}>
                Used in the file name and URL. Auto-generated from the title.
              </p>
            </div>

            <button
              onClick={handleCreate}
              disabled={saving || !title}
              className="btn btn-primary"
              style={{ alignSelf: "flex-start" }}
            >
              {saving ? "Creating..." : "Create Article"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
