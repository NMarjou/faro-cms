"use client";

import { useState, useRef, useEffect } from "react";

type TabType = "articles" | "toc" | "variables" | "snippets" | "images";

interface FileData {
  name: string;
  content: string;
}

interface ImportResult {
  success: boolean;
  message: string;
}

// ─── File Drop Zone ──────────────────────────────────────────────────
function DropZone({
  accept,
  label,
  files,
  onFiles,
}: {
  accept: string;
  label: string;
  files: FileData[];
  onFiles: (files: FileData[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFiles = async (fileList: FileList) => {
    const results: FileData[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const isBinary = file.name.toLowerCase().endsWith(".docx");
      if (isBinary) {
        // Read as base64 for binary formats
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
        results.push({ name: file.name, content: btoa(binary) });
      } else {
        results.push({ name: file.name, content: await file.text() });
      }
    }
    onFiles([...files, ...results]);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) readFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--radius)",
        padding: "32px 24px",
        textAlign: "center",
        cursor: "pointer",
        background: dragOver ? "var(--accent-light, #eff6ff)" : "var(--bg-secondary, #fafafa)",
        transition: "all 0.15s",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) readFiles(e.target.files); }}
      />
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <p style={{ fontSize: 14, color: "var(--fg-muted)", margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: 12, color: "var(--fg-muted)", margin: "4px 0 0", opacity: 0.7 }}>
        Drop files here or click to browse
      </p>
    </div>
  );
}

// ─── File List ───────────────────────────────────────────────────────
function FileList({ files, onRemove }: { files: FileData[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null;
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
      {files.map((f, i) => (
        <div
          key={`${f.name}-${i}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 12px",
            background: "var(--bg-secondary, #fafafa)",
            borderRadius: "var(--radius)",
            fontSize: 13,
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{f.name}</span>
          <button
            onClick={() => onRemove(i)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--fg-muted)",
              fontSize: 14,
              padding: "2px 6px",
            }}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── TOC structure types for article mapping ────────────────────────
interface TocData {
  categories: { name: string; slug: string; description: string; sections: { name: string; slug: string; articles: { title: string; slug: string; file: string; format?: string; tags?: string[]; conditions?: string[] }[] }[] }[];
}

interface ArticleMapping {
  title: string;
  path: string;
  category: string; // slug
  section: string;  // slug
  newCategory: string;
  newSection: string;
}

// ─── Tab Components ──────────────────────────────────────────────────
function ArticlesTab() {
  const [files, setFiles] = useState<FileData[]>([]);
  const [preview, setPreview] = useState<{ filename: string; title: string; content: string; path: string }[] | null>(null);
  const [folder, setFolder] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Post-import mapping state
  const [step, setStep] = useState<"upload" | "mapping">("upload");
  const [importedArticles, setImportedArticles] = useState<{ title: string; path: string }[]>([]);
  const [toc, setToc] = useState<TocData | null>(null);
  const [mappings, setMappings] = useState<ArticleMapping[]>([]);

  // Load TOC once for the mapping step
  useEffect(() => {
    fetch("/api/toc")
      .then((r) => r.json())
      .then((data) => { if (data.categories) setToc(data); })
      .catch(() => {});
  }, []);

  const handlePreview = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "preview-articles", files }),
      });
      const data = await res.json();
      setPreview(data.results);
    } catch { setResult({ success: false, message: "Preview failed" }); }
    finally { setLoading(false); }
  };

  const handleImport = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "import-articles", files, folder }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: `Imported ${data.results.length} article(s). Now map them to TOC locations.` });
        setImportedArticles(data.results);
        setPreview(null);

        // Initialise mappings with empty category/section
        setMappings(data.results.map((a: { title: string; path: string }) => ({
          title: a.title,
          path: a.path,
          category: "",
          section: "",
          newCategory: "",
          newSection: "",
        })));

        setStep("mapping");
      } else {
        setResult({ success: false, message: data.error });
      }
    } catch { setResult({ success: false, message: "Import failed" }); }
    finally { setLoading(false); }
  };

  const updateMapping = (index: number, field: keyof ArticleMapping, value: string) => {
    setMappings((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      // Reset section when category changes
      if (field === "category") {
        next[index].section = "";
        next[index].newSection = "";
      }
      return next;
    });
  };

  const applyToAll = (field: "category" | "section", value: string) => {
    setMappings((prev) => prev.map((m) => {
      const updated = { ...m, [field]: value };
      if (field === "category") { updated.section = ""; updated.newSection = ""; }
      return updated;
    }));
  };

  const handleSaveMapping = async () => {
    if (!toc) return;
    setLoading(true);
    try {
      const updatedToc = JSON.parse(JSON.stringify(toc)) as TocData;

      for (const m of mappings) {
        // Determine actual category slug — could be new
        let catSlug = m.category;
        if (catSlug === "__new__" && m.newCategory.trim()) {
          const newSlug = slugify(m.newCategory.trim());
          if (!updatedToc.categories.find((c) => c.slug === newSlug)) {
            updatedToc.categories.push({
              name: m.newCategory.trim(),
              slug: newSlug,
              description: "",
              sections: [],
            });
          }
          catSlug = newSlug;
        }

        if (!catSlug || catSlug === "__new__") continue; // skip unmapped

        const cat = updatedToc.categories.find((c) => c.slug === catSlug);
        if (!cat) continue;

        // Determine actual section slug — could be new
        let secSlug = m.section;
        if (secSlug === "__new__" && m.newSection.trim()) {
          const newSlug = slugify(m.newSection.trim());
          if (!cat.sections.find((s) => s.slug === newSlug)) {
            cat.sections.push({ name: m.newSection.trim(), slug: newSlug, articles: [] });
          }
          secSlug = newSlug;
        }

        if (!secSlug || secSlug === "__new__") continue; // skip unmapped

        const sec = cat.sections.find((s) => s.slug === secSlug);
        if (!sec) continue;

        // Add article if not already present
        const artSlug = slugify(m.title);
        if (!sec.articles.find((a) => a.slug === artSlug)) {
          sec.articles.push({
            title: m.title,
            slug: artSlug,
            file: m.path,
            format: "html",
            tags: [],
            conditions: [],
          });
        }
      }

      // Save updated TOC
      const res = await fetch("/api/toc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toc: updatedToc, message: "Map imported articles to TOC" }),
      });

      if (res.ok) {
        setToc(updatedToc);
        const mapped = mappings.filter((m) => m.category && m.category !== "__new__" || (m.category === "__new__" && m.newCategory.trim()));
        setResult({ success: true, message: `TOC updated — ${mapped.length} article(s) mapped.` });
        setStep("upload");
        setFiles([]);
        setImportedArticles([]);
        setMappings([]);
      } else {
        const data = await res.json();
        setResult({ success: false, message: data.error || "Failed to save TOC" });
      }
    } catch { setResult({ success: false, message: "Failed to save mapping" }); }
    finally { setLoading(false); }
  };

  // ─── Mapping step UI ──────────────────────────────────────────────
  if (step === "mapping") {
    const allCategories = toc?.categories || [];
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Map articles to TOC</h3>
            <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "4px 0 0" }}>
              Assign each imported article to a category and section in the CMS table of contents.
            </p>
          </div>
          <button
            className="btn"
            onClick={() => { setStep("upload"); setResult(null); }}
            style={{ fontSize: 12 }}
          >
            Skip mapping
          </button>
        </div>

        {/* Bulk assign */}
        {importedArticles.length > 1 && (
          <div className="card" style={{ padding: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Apply to all:</span>
            <select
              className="input"
              style={{ width: "auto", fontSize: 13 }}
              value=""
              onChange={(e) => { if (e.target.value) applyToAll("category", e.target.value); }}
            >
              <option value="">Set category...</option>
              {allCategories.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
              <option value="__new__">+ New category</option>
            </select>
          </div>
        )}

        {/* Per-article mapping rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {mappings.map((m, i) => {
            const selectedCat = allCategories.find((c) => c.slug === m.category);
            const sections = selectedCat?.sections || [];

            return (
              <div
                key={i}
                className="card"
                style={{
                  padding: 12,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 12,
                  alignItems: "start",
                }}
              >
                {/* Article info */}
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{m.title}</div>
                  <code style={{ fontSize: 11, color: "var(--fg-muted)" }}>{m.path}</code>
                </div>

                {/* Category selector */}
                <div>
                  <label style={{ fontSize: 11, color: "var(--fg-muted)", display: "block", marginBottom: 2 }}>Category</label>
                  <select
                    className="input"
                    style={{ width: "100%", fontSize: 13 }}
                    value={m.category}
                    onChange={(e) => updateMapping(i, "category", e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {allCategories.map((c) => (
                      <option key={c.slug} value={c.slug}>{c.name}</option>
                    ))}
                    <option value="__new__">+ New category</option>
                  </select>
                  {m.category === "__new__" && (
                    <input
                      className="input"
                      style={{ width: "100%", fontSize: 13, marginTop: 4 }}
                      placeholder="Category name"
                      value={m.newCategory}
                      onChange={(e) => updateMapping(i, "newCategory", e.target.value)}
                    />
                  )}
                </div>

                {/* Section selector */}
                <div>
                  <label style={{ fontSize: 11, color: "var(--fg-muted)", display: "block", marginBottom: 2 }}>Section</label>
                  <select
                    className="input"
                    style={{ width: "100%", fontSize: 13 }}
                    value={m.section}
                    onChange={(e) => updateMapping(i, "section", e.target.value)}
                    disabled={!m.category || (m.category === "__new__" && !m.newCategory.trim())}
                  >
                    <option value="">— Select —</option>
                    {sections.map((s) => (
                      <option key={s.slug} value={s.slug}>{s.name}</option>
                    ))}
                    <option value="__new__">+ New section</option>
                  </select>
                  {m.section === "__new__" && (
                    <input
                      className="input"
                      style={{ width: "100%", fontSize: 13, marginTop: 4 }}
                      placeholder="Section name"
                      value={m.newSection}
                      onChange={(e) => updateMapping(i, "newSection", e.target.value)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={handleSaveMapping} disabled={loading}>
            {loading ? "Saving..." : "Save TOC mapping"}
          </button>
          <button className="btn" onClick={() => { setStep("upload"); setResult(null); }}>
            Skip
          </button>
        </div>

        <ResultBanner result={result} />
      </div>
    );
  }

  // ─── Upload step UI ───────────────────────────────────────────────
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 16 }}>
        Import articles from Madcap Flare (<code>.htm</code> / <code>.html</code>), Word (<code>.docx</code>),
        or Markdown (<code>.md</code>) files. Madcap-specific elements are automatically converted.
        Word and Markdown are converted to HTML. After import, you can map each article to a location in the TOC.
      </p>
      <DropZone
        accept=".htm,.html,.docx,.md,.markdown"
        label="Drop .htm, .html, .docx, or .md article files"
        files={files}
        onFiles={setFiles}
      />
      <FileList files={files} onRemove={(i) => setFiles(files.filter((_, idx) => idx !== i))} />

      {files.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>
            Target folder (optional)
          </label>
          <input
            className="input"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="e.g. help/passport"
            style={{ maxWidth: 300 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={handlePreview} disabled={loading}>
              Preview
            </button>
            <button className="btn btn-primary" onClick={handleImport} disabled={loading}>
              {loading ? "Importing..." : "Import"}
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Preview</h3>
          {preview.map((p, i) => (
            <div key={i} className="card" style={{ marginBottom: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>{p.title}</strong>
                <code style={{ fontSize: 11, color: "var(--fg-muted)" }}>{p.path}</code>
              </div>
              <div
                style={{
                  background: "var(--bg-secondary)",
                  padding: 12,
                  borderRadius: "var(--radius)",
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  maxHeight: 200,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                }}
                dangerouslySetInnerHTML={{ __html: escapeHtml(p.content.substring(0, 2000)) }}
              />
            </div>
          ))}
        </div>
      )}

      <ResultBanner result={result} />
    </div>
  );
}

function TocTab() {
  const [files, setFiles] = useState<FileData[]>([]);
  const [preview, setPreview] = useState<{ categories: { name: string; slug: string; sections: { name: string; articles: { title: string }[] }[] }[] } | null>(null);
  const [merge, setMerge] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePreview = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "preview-toc", files: [files[0]] }),
      });
      const data = await res.json();
      setPreview(data.toc);
    } catch { setResult({ success: false, message: "Preview failed" }); }
    finally { setLoading(false); }
  };

  const handleImport = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "import-toc", files: [files[0]], merge }),
      });
      const data = await res.json();
      if (data.success) {
        const catCount = data.toc.categories.length;
        const artCount = data.toc.categories.reduce(
          (sum: number, c: { sections: { articles: unknown[] }[] }) =>
            sum + c.sections.reduce((s: number, sec: { articles: unknown[] }) => s + sec.articles.length, 0), 0);
        setResult({ success: true, message: `Imported TOC: ${catCount} categories, ${artCount} articles` });
        setPreview(null);
      } else {
        setResult({ success: false, message: data.error });
      }
    } catch { setResult({ success: false, message: "Import failed" }); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 16 }}>
        Import a table of contents from a Madcap Flare <code>.fltoc</code> file. The 3-level structure
        (Category &gt; Section &gt; Article) is automatically mapped.
      </p>
      <DropZone
        accept=".fltoc"
        label="Drop a Madcap Flare .fltoc file"
        files={files}
        onFiles={(f) => setFiles(f.slice(-1))} // only keep last file
      />
      <FileList files={files} onRemove={() => setFiles([])} />

      {files.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
            Merge with existing TOC (adds new categories/sections/articles without replacing existing ones)
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={handlePreview} disabled={loading}>
              Preview
            </button>
            <button className="btn btn-primary" onClick={handleImport} disabled={loading}>
              {loading ? "Importing..." : "Import"}
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>TOC Preview</h3>
          {preview.categories.map((cat, ci) => (
            <div key={ci} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                {cat.name}
              </div>
              {cat.sections.map((sec, si) => (
                <div key={si} style={{ marginLeft: 16, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)", marginBottom: 2 }}>
                    {sec.name}
                    <span style={{ fontWeight: 400, color: "var(--fg-muted)", marginLeft: 8 }}>
                      ({sec.articles.length} article{sec.articles.length !== 1 ? "s" : ""})
                    </span>
                  </div>
                  <div style={{ marginLeft: 16 }}>
                    {sec.articles.map((art, ai) => (
                      <div key={ai} style={{ fontSize: 12, color: "var(--fg-muted)", padding: "1px 0" }}>
                        {art.title}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <ResultBanner result={result} />
    </div>
  );
}

function VariablesTab() {
  const [files, setFiles] = useState<FileData[]>([]);
  const [preview, setPreview] = useState<{ setName: string; variables: Record<string, string> }[] | null>(null);
  const [setName, setSetName] = useState("");
  const [merge, setMerge] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePreview = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "preview-variables", files, setName: setName || undefined }),
      });
      const data = await res.json();
      setPreview(data.results);
    } catch { setResult({ success: false, message: "Preview failed" }); }
    finally { setLoading(false); }
  };

  const handleImport = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "import-variables", files, setName: setName || undefined, merge }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: `Imported ${data.count} variables into set "${data.setName}"` });
        setPreview(null);
      } else {
        setResult({ success: false, message: data.error });
      }
    } catch { setResult({ success: false, message: "Import failed" }); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 16 }}>
        Import variables from Madcap Flare <code>.flvar</code> files. Variables are imported as a new variable set.
      </p>
      <DropZone
        accept=".flvar"
        label="Drop Madcap Flare .flvar variable files"
        files={files}
        onFiles={setFiles}
      />
      <FileList files={files} onRemove={(i) => setFiles(files.filter((_, idx) => idx !== i))} />

      {files.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>
            Variable set name
          </label>
          <input
            className="input"
            value={setName}
            onChange={(e) => setSetName(e.target.value)}
            placeholder={files[0]?.name.replace(/\.flvar$/, "") || "Imported"}
            style={{ maxWidth: 300 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
            Merge with existing set (add variables without replacing existing ones)
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={handlePreview} disabled={loading}>
              Preview
            </button>
            <button className="btn btn-primary" onClick={handleImport} disabled={loading}>
              {loading ? "Importing..." : "Import"}
            </button>
          </div>
        </div>
      )}

      {preview && preview.map((p, pi) => (
        <div key={pi} style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            Set: {p.setName} ({Object.keys(p.variables).length} variables)
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1px", background: "var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ padding: "6px 12px", fontWeight: 600, fontSize: 12, background: "var(--bg-secondary)" }}>Name</div>
            <div style={{ padding: "6px 12px", fontWeight: 600, fontSize: 12, background: "var(--bg-secondary)" }}>Value</div>
            {Object.entries(p.variables).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <div style={{ padding: "4px 12px", fontSize: 13, fontFamily: "var(--font-mono)", background: "var(--bg)" }}>{k}</div>
                <div style={{ padding: "4px 12px", fontSize: 13, background: "var(--bg)" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <ResultBanner result={result} />
    </div>
  );
}

function SnippetsTab() {
  const [files, setFiles] = useState<FileData[]>([]);
  const [preview, setPreview] = useState<{ filename: string; name: string; content: string }[] | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePreview = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "preview-snippets", files }),
      });
      const data = await res.json();
      setPreview(data.results);
    } catch { setResult({ success: false, message: "Preview failed" }); }
    finally { setLoading(false); }
  };

  const handleImport = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "import-snippets", files }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: `Imported ${data.results.length} snippet(s)` });
        setPreview(null);
      } else {
        setResult({ success: false, message: data.error });
      }
    } catch { setResult({ success: false, message: "Import failed" }); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 16 }}>
        Import snippets from Madcap Flare <code>.flsnp</code> files. Snippet content is converted to HTML
        with CMS-compatible variable and snippet references.
      </p>
      <DropZone
        accept=".flsnp"
        label="Drop Madcap Flare .flsnp snippet files"
        files={files}
        onFiles={setFiles}
      />
      <FileList files={files} onRemove={(i) => setFiles(files.filter((_, idx) => idx !== i))} />

      {files.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={handlePreview} disabled={loading}>
            Preview
          </button>
          <button className="btn btn-primary" onClick={handleImport} disabled={loading}>
            {loading ? "Importing..." : "Import"}
          </button>
        </div>
      )}

      {preview && preview.map((p, i) => (
        <div key={i} className="card" style={{ marginTop: 12, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>{p.name}</strong>
            <code style={{ fontSize: 11, color: "var(--fg-muted)" }}>{p.filename}</code>
          </div>
          <div
            style={{
              background: "var(--bg-secondary)",
              padding: 12,
              borderRadius: "var(--radius)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              maxHeight: 200,
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {p.content.substring(0, 2000)}
          </div>
        </div>
      ))}

      <ResultBanner result={result} />
    </div>
  );
}

function ImagesTab() {
  const [files, setFiles] = useState<FileData[]>([]);
  const [folder, setFolder] = useState("");
  const [preview, setPreview] = useState<{ filename: string; size: number; path: string }[] | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Images need base64 reading — override the drop zone's readFiles
  const handleImageFiles = async (newFiles: FileData[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handlePreview = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "preview-images",
          files: files.map((f) => ({ name: f.name, content: f.content, size: Math.round((f.content.length * 3) / 4) })),
          folder,
        }),
      });
      const data = await res.json();
      setPreview(data.results);
    } catch { setResult({ success: false, message: "Preview failed" }); }
    finally { setLoading(false); }
  };

  const handleImport = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "import-images", files, folder }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: `Imported ${data.results.length} image(s)` });
        setPreview(null);
        setFiles([]);
      } else {
        setResult({ success: false, message: data.error });
      }
    } catch { setResult({ success: false, message: "Import failed" }); }
    finally { setLoading(false); }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 16 }}>
        Import images (PNG, JPEG, SVG, GIF) into the CMS. Images are stored in the <code>images/</code> directory
        and can be organised into folders.
      </p>
      <ImageDropZone
        files={files}
        onFiles={handleImageFiles}
      />
      <FileList files={files} onRemove={(i) => setFiles(files.filter((_, idx) => idx !== i))} />

      {files.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>
            Target folder (optional)
          </label>
          <input
            className="input"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="e.g. screenshots/passport"
            style={{ maxWidth: 300 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={handlePreview} disabled={loading}>
              Preview
            </button>
            <button className="btn btn-primary" onClick={handleImport} disabled={loading}>
              {loading ? "Importing..." : `Import ${files.length} image${files.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            Preview — {preview.length} image{preview.length !== 1 ? "s" : ""}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
            {preview.map((p, i) => {
              const ext = p.filename.split(".").pop()?.toLowerCase() || "";
              const isPreviewable = ["png", "jpg", "jpeg", "gif", "svg"].includes(ext);
              const mimeMap: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml" };
              return (
                <div key={i} className="card" style={{ padding: 8, textAlign: "center" }}>
                  {isPreviewable && files[i] && (
                    <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6, overflow: "hidden", borderRadius: 4, background: "var(--bg-secondary)" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:${mimeMap[ext] || "image/png"};base64,${files[i].content}`}
                        alt={p.filename}
                        style={{ maxWidth: "100%", maxHeight: 100, objectFit: "contain" }}
                      />
                    </div>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 500, wordBreak: "break-all" }}>{p.filename}</div>
                  <div style={{ fontSize: 11, color: "var(--fg-muted)" }}>{formatSize(p.size)}</div>
                  <code style={{ fontSize: 10, color: "var(--fg-muted)" }}>{p.path}</code>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ResultBanner result={result} />
    </div>
  );
}

// ─── Image Drop Zone (reads as base64) ───────────────────────────────
function ImageDropZone({
  files,
  onFiles,
}: {
  files: FileData[];
  onFiles: (files: FileData[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFiles = async (fileList: FileList) => {
    const results: FileData[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
      results.push({ name: file.name, content: btoa(binary) });
    }
    onFiles(results);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) readFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--radius)",
        padding: "32px 24px",
        textAlign: "center",
        cursor: "pointer",
        background: dragOver ? "var(--accent-light, #eff6ff)" : "var(--bg-secondary, #fafafa)",
        transition: "all 0.15s",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.gif,.svg"
        multiple
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) readFiles(e.target.files); }}
      />
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--fg-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
      <p style={{ fontSize: 14, color: "var(--fg-muted)", margin: 0 }}>
        Drop image files (PNG, JPEG, SVG, GIF)
      </p>
      <p style={{ fontSize: 12, color: "var(--fg-muted)", margin: "4px 0 0", opacity: 0.7 }}>
        Drop files here or click to browse
      </p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────
function ResultBanner({ result }: { result: ImportResult | null }) {
  if (!result) return null;
  return (
    <div
      style={{
        marginTop: 16,
        padding: "10px 16px",
        borderRadius: "var(--radius)",
        background: result.success ? "var(--success-light, #ecfdf5)" : "var(--danger-light, #fef2f2)",
        color: result.success ? "var(--success, #059669)" : "var(--danger, #dc2626)",
        fontSize: 14,
      }}
    >
      {result.success ? "Done" : "Error"}: {result.message}
    </div>
  );
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Main Page ───────────────────────────────────────────────────────
export default function ImportPage() {
  const [activeTab, setActiveTab] = useState<TabType>("articles");

  const tabs: { key: TabType; label: string; icon: string }[] = [
    { key: "articles", label: "Articles", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M16 13H8|M16 17H8|M10 9H8" },
    { key: "toc", label: "TOC", icon: "M3 6h18|M3 12h18|M3 18h18|M8 6v12" },
    { key: "variables", label: "Variables", icon: "M4 7V4h16v3|M9 20h6|M12 4v16" },
    { key: "snippets", label: "Snippets", icon: "M16 18l6-6-6-6|M8 6l-6 6 6 6" },
    { key: "images", label: "Images", icon: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M17 8l-5 5-2.5-2.5L3 17|M14 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6" },
  ];

  return (
    <>
      <header className="main-header">
        <h1>Import</h1>
      </header>
      <div className="main-body">
        <div className="card" style={{ marginBottom: 16, padding: "12px 16px" }}>
          <p style={{ fontSize: 14, color: "var(--fg-muted)", margin: 0 }}>
            Import content into the CMS. Articles: <code>.htm</code> / <code>.html</code> (Madcap Flare),
            <code>.docx</code> (Word), <code>.md</code> (Markdown). Madcap Flare: <code>.fltoc</code> (TOC),
            <code>.flvar</code> (variables), <code>.flsnp</code> (snippets). All formats are converted to CMS-compatible HTML.
          </p>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 20px",
                border: "none",
                borderBottom: activeTab === tab.key ? "2px solid var(--accent)" : "2px solid transparent",
                background: "none",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? "var(--accent)" : "var(--fg-muted)",
                transition: "all 0.1s",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {tab.icon.split("|").map((d, i) => <path key={i} d={d} />)}
              </svg>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ maxWidth: 800 }}>
          {activeTab === "articles" && <ArticlesTab />}
          {activeTab === "toc" && <TocTab />}
          {activeTab === "variables" && <VariablesTab />}
          {activeTab === "snippets" && <SnippetsTab />}
          {activeTab === "images" && <ImagesTab />}
        </div>
      </div>
    </>
  );
}
