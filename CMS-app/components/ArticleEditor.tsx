"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import dynamic from "next/dynamic";
import { useTabContext } from "./TabContext";
import Icon from "./Icon";
import type {
  Variables,
  GlossaryTerm,
  ContentStyle,
  TocArticle,
  Toc,
} from "@/lib/types";

function formatHtml(html: string): string {
  const BLOCK_TAGS = new Set([
    "div","p","h1","h2","h3","h4","h5","h6","ul","ol","li",
    "table","thead","tbody","tr","th","td","blockquote","pre",
    "hr","br","section","article","nav","header","footer","main",
    "figure","figcaption","iframe",
  ]);
  let result = "";
  let indent = 0;
  const pad = () => "  ".repeat(indent);
  const tokens = html.split(/(<\/?[^>]+>)/g).filter(Boolean);
  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("</")) {
      const tag = trimmed.match(/<\/(\w+)/)?.[1]?.toLowerCase() || "";
      if (BLOCK_TAGS.has(tag)) { indent = Math.max(0, indent - 1); result += `\n${pad()}${trimmed}`; }
      else result += trimmed;
    } else if (trimmed.startsWith("<")) {
      const tag = trimmed.match(/<(\w+)/)?.[1]?.toLowerCase() || "";
      const selfClosing = trimmed.endsWith("/>") || tag === "br" || tag === "hr";
      if (BLOCK_TAGS.has(tag)) { result += `\n${pad()}${trimmed}`; if (!selfClosing) indent++; }
      else result += trimmed;
    } else {
      result += trimmed;
    }
  }
  return result.trim();
}

const Editor = dynamic(() => import("@/components/Editor/Editor"), {
  ssr: false,
  loading: () => <p>Loading editor...</p>,
});

const SourceView = dynamic(() => import("@/components/Editor/SourceView"), {
  ssr: false,
});

interface ArticleEditorProps {
  file: string;
}

export default function ArticleEditor({ file: filePath }: ArticleEditorProps) {
  const { markDirty, closeTab } = useTabContext();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [articleMeta, setArticleMeta] = useState<TocArticle | null>(null);
  const isSnippet = filePath.startsWith("snippets/");
  const [snippetTitle, setSnippetTitle] = useState<string | null>(null);
  const [format, setFormat] = useState<"html" | "mdx">("html");
  const [initialContent, setInitialContent] = useState<JSONContent | null>(null);
  const [initialHtml, setInitialHtml] = useState<string>("");
  const [rawSource, setRawSource] = useState("");
  const [variables, setVariables] = useState<Variables>({});
  const [conditionTags, setConditionTags] = useState<string[]>([]);
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTerm[]>([]);
  const [styles, setStyles] = useState<ContentStyle[]>([]);
  const [snippetNames, setSnippetNames] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [publishUrl, setPublishUrl] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"visual" | "source">("visual");
  const [sourceHighlight, setSourceHighlight] = useState<string | undefined>(undefined);
  const [showMeta, setShowMeta] = useState(false);
  const [lastAutoSaved, setLastAutoSaved] = useState<string | null>(null);
  const [autosaveInterval, setAutosaveInterval] = useState(120);

  const editorContentRef = useRef<JSONContent | null>(null);
  const editorRef = useRef<{ getHTML: () => string; getSelectedText: () => string } | null>(null);
  const loadedRef = useRef(false);
  const saveRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // Sync dirty state to tab context
  useEffect(() => { markDirty(filePath, isDirty); }, [isDirty, filePath, markDirty]);

  useEffect(() => {
    const saved = localStorage.getItem("cms-autosave-interval");
    if (saved) setAutosaveInterval(Number(saved));
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    // Fire requests in parallel; render editor as soon as article body
    // resolves, then stream metadata in as it arrives. The 5 toolbar-
    // metadata reads are bundled into /api/editor-meta to dodge the
    // browser 6-connection limit and per-route dev-compile cost.
    const articlePromise = fetch(`/api/article?path=${encodeURIComponent(filePath)}`);
    const tocPromise = isSnippet ? null : fetch("/api/toc").catch(() => null);
    const metaPromise = fetch("/api/editor-meta").catch(() => null);

    (async () => {
      try {
        const articleRes = await articlePromise;
        if (!articleRes.ok) throw new Error("Failed to load article");
        const articleData = await articleRes.json();

        const isHtml = articleData.format === "html";
        setFormat(isHtml ? "html" : "mdx");

        if (isHtml) {
          setInitialHtml(articleData.content);
          setRawSource(articleData.content);
        } else {
          setRawSource(articleData.raw);
          const parseRes = await fetch("/api/article/parse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mdx: articleData.raw }),
          });
          if (!parseRes.ok) throw new Error("Failed to parse article");
          const { doc } = await parseRes.json();
          setInitialContent(doc);
          editorContentRef.current = doc;
        }

        if (isSnippet) {
          if (articleData.frontmatter?.name) {
            setSnippetTitle(articleData.frontmatter.name);
          } else {
            const raw = articleData.content || articleData.raw || "";
            const m = raw.match(/<!--\s*name:\s*(.+?)\s*-->/);
            if (m) setSnippetTitle(m[1]);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();

    tocPromise?.then(async (res) => {
      if (!res?.ok) return;
      try {
        const toc: Toc = await res.json();
        const found = findArticleInToc(toc, filePath);
        if (found) setArticleMeta(found);
      } catch { /* */ }
    });

    metaPromise.then(async (res) => {
      if (!res?.ok) return;
      try {
        const meta = await res.json();
        setVariables(meta.variables || {});
        setConditionTags(meta.conditions?.tags || []);
        setGlossaryTerms(meta.glossary?.terms || []);
        setStyles(Array.isArray(meta.styles) ? meta.styles : []);
        setSnippetNames(meta.snippetNames || []);
      } catch { /* */ }
    });
  }, [filePath, isSnippet]);

  function findArticleInToc(toc: Toc, file: string): TocArticle | null {
    for (const cat of toc.categories) {
      for (const sec of cat.sections) {
        const art = sec.articles.find((a) => a.file === file);
        if (art) return art;
      }
    }
    return toc.articles?.find((a) => a.file === file) || null;
  }

  const handleEditorChange = useCallback((content: JSONContent) => {
    editorContentRef.current = content;
    setIsDirty(true);
  }, []);

  const handleSourceChange = (source: string) => {
    setRawSource(source);
    setInitialHtml(source);
    setIsDirty(true);
  };

  const getEditorHtml = (): string => {
    if (editorRef.current) return editorRef.current.getHTML();
    return rawSource;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const content = viewMode === "source" ? rawSource : getEditorHtml();
      if (viewMode !== "source") setRawSource(content);

      const res = await fetch("/api/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content, message: `Update ${articleMeta?.title || filePath}` }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Save failed"); }

      if (articleMeta) {
        const tocRes = await fetch("/api/toc");
        if (tocRes.ok) {
          const toc = await tocRes.json();
          const art = findArticleInToc(toc, filePath);
          if (art) {
            art.lastModified = new Date().toISOString().split("T")[0];
            await fetch("/api/toc", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toc }) });
          }
        }
      }
      setIsDirty(false);
      setLastAutoSaved(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  saveRef.current = handleSave;

  useEffect(() => {
    if (autosaveInterval <= 0) return;
    const timer = setInterval(() => { if (isDirty && !saving) saveRef.current?.(); }, autosaveInterval * 1000);
    return () => clearInterval(timer);
  }, [autosaveInterval, isDirty, saving]);

  const handlePublish = async () => {
    await handleSave();
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Update: ${articleMeta?.title || filePath}`, description: `Content update for ${filePath}` }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Publish failed"); }
      setPublishUrl((await res.json()).prUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    }
  };

  if (loading) return <div className="main-body article-editor"><p>Loading article...</p></div>;

  if (error && !initialHtml && !initialContent) {
    return <div className="main-body article-editor"><div className="card" style={{ color: "var(--danger)" }}>{error}</div></div>;
  }

  const title = isSnippet ? (snippetTitle || filePath) : (articleMeta?.title || filePath);

  return (
    <>
      <header className="main-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 16 }}>{title}</h1>
          <span className="badge">{isSnippet ? "SNIPPET" : format.toUpperCase()}</span>
          {isDirty ? (
            <span className="badge" style={{ background: "var(--warning-light)", color: "var(--warning)" }}>Unsaved</span>
          ) : lastAutoSaved ? (
            <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>Saved {lastAutoSaved}</span>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div
            className="view-toggle"
            onClick={() => {
              if (viewMode === "visual") {
                // Capture selected text before switching
                const selectedText = editorRef.current?.getSelectedText() || "";
                if (isDirty) handleSave();
                if (editorRef.current) setRawSource(formatHtml(editorRef.current.getHTML()));
                setSourceHighlight(selectedText || undefined);
                setViewMode("source");
              } else {
                if (isDirty) handleSave();
                setSourceHighlight(undefined);
                setViewMode("visual");
              }
            }}
          >
            <span className={`view-toggle-label${viewMode === "visual" ? " active" : ""}`}>Visual</span>
            <div className={`view-toggle-track${viewMode === "source" ? " on" : ""}`}>
              <div className="view-toggle-thumb" />
            </div>
            <span className={`view-toggle-label${viewMode === "source" ? " active" : ""}`}>Source</span>
          </div>
          <button onClick={() => setShowMeta((p) => !p)} className={`btn btn-sm${showMeta ? " btn-primary" : ""}`} title="Article metadata">Meta</button>
          <button onClick={handleSave} disabled={saving || !isDirty} className="btn" style={{ opacity: saving || !isDirty ? 0.5 : 1, padding: "6px 10px" }} title={saving ? "Saving..." : "Save (Ctrl+S)"}>
            <Icon name="floppy-disk" size={16} title="Save" />
          </button>
          <button onClick={handlePublish} className="btn btn-primary">Publish</button>
        </div>
      </header>
      <div className="main-body article-editor">
        {error && <div style={{ background: "var(--danger-light)", color: "var(--danger)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>{error}</div>}
        {publishUrl && <div style={{ background: "var(--success-light)", color: "var(--success)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>PR created: <a href={publishUrl} target="_blank" rel="noreferrer">{publishUrl}</a></div>}

        {/* Meta drawer */}
        <div className={`meta-drawer${showMeta ? " open" : ""}`}>
          <div className="meta-drawer-header">
            <span style={{ fontWeight: 600, fontSize: 14 }}>Metadata</span>
            <button onClick={() => setShowMeta(false)} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: "var(--fg-muted)" }}>×</button>
          </div>
          {articleMeta && (
            <div className="meta-drawer-body">
              <div className="meta-field">
                <label>Title</label>
                <input className="input" value={articleMeta.title} onChange={(e) => { setArticleMeta((p) => p ? { ...p, title: e.target.value } : p); setIsDirty(true); }} />
              </div>
              <div className="meta-field">
                <label>Slug</label>
                <input className="input" value={articleMeta.slug} onChange={(e) => { setArticleMeta((p) => p ? { ...p, slug: e.target.value } : p); setIsDirty(true); }} />
              </div>
              <div className="meta-field">
                <label>Format</label>
                <span className="badge">{format.toUpperCase()}</span>
              </div>
              <div className="meta-field">
                <label>Created</label>
                <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>{articleMeta.createdDate || "Unknown"}</span>
              </div>
              <div className="meta-field">
                <label>Last Modified</label>
                <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>{articleMeta.lastModified || "Never"}</span>
              </div>
              <div className="meta-field">
                <label>Tags (comma-separated)</label>
                <input className="input" value={(articleMeta.tags || []).join(", ")} onChange={(e) => { setArticleMeta((p) => p ? { ...p, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) } : p); setIsDirty(true); }} />
              </div>
              <div className="meta-field">
                <label>File</label>
                <span style={{ fontSize: 12, color: "var(--fg-muted)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{filePath}</span>
              </div>
            </div>
          )}
        </div>

        {viewMode === "visual" && (
          <Editor
            initialContent={format === "html" ? undefined : initialContent || undefined}
            initialHtml={format === "html" ? initialHtml : undefined}
            variables={variables}
            conditionTags={conditionTags}
            snippetNames={snippetNames}
            glossaryTerms={glossaryTerms}
            styles={styles}
            onChange={handleEditorChange}
            onEditorReady={(editor) => { editorRef.current = { getHTML: () => editor.getHTML(), getSelectedText: () => editor.getSelectedText() }; }}
          />
        )}
        {viewMode === "source" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <SourceView value={rawSource} onChange={handleSourceChange} highlightText={sourceHighlight} />
          </div>
        )}
      </div>
    </>
  );
}
