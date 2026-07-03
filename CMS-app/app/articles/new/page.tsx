"use client";

import { useState, useEffect } from "react";
import PageHeader from "@/components/PageHeader";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import TechWriterBlocked from "@/components/TechWriterBlocked";

export default function NewArticlePage() {
  const router = useRouter();
  const { role, loaded } = useCurrentUser();
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
      // Single authorized step: writes the body AND inserts the TOC entry with
      // the creator stamped as owner server-side. Authors go through here too
      // (the old flow's direct PUT /api/toc is tech-writer-only, so it 403'd for
      // authors and lost the entry — leaving their article read-only).
      const res = await fetch("/api/article/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, slug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create article");
      }
      const { path } = await res.json();
      router.push(`/editor/${encodeURIComponent(path)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  if (loaded && role === "contributor") {
    return <TechWriterBlocked title="New Article" />;
  }

  return (
    <>
      <PageHeader title="New Article">
      </PageHeader>
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
