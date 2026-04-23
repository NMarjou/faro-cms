"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import dynamic from "next/dynamic";
import { useTabContext } from "./TabContext";
import type {
  Variables,
  ConditionsConfig,
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

    async function load() {
      try {
        const articleRes = await fetch(`/api/article?path=${encodeURIComponent(filePath)}`);
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
        } else {
          const tocRes = await fetch("/api/toc");
          if (tocRes.ok) {
            const toc: Toc = await tocRes.json();
            const found = findArticleInToc(toc, filePath);
            if (found) setArticleMeta(found);
          }
        }

        const [varsRes, condsRes, glossaryRes, stylesRes, snippetsRes] = await Promise.all([
          fetch("/api/variables").catch(() => null),
          fetch("/api/content?path=conditions.json").catch(() => null),
          fetch("/api/glossary").catch(() => null),
          fetch("/api/content?path=styles.json").catch(() => null),
          fetch("/api/snippets").catch(() => null),
        ]);

        if (varsRes?.ok) setVariables(await varsRes.json());
        if (condsRes?.ok) {
          try { const d = await condsRes.json(); const c: ConditionsConfig = d.content ? JSON.parse(d.content) : d; setConditionTags(c.tags || []); } catch { /* */ }
        }
        if (glossaryRes?.ok) { const g = await glossaryRes.json(); setGlossaryTerms(g.terms || []); }
        if (stylesRes?.ok) {
          try { const d = await stylesRes.json(); const s = d.content ? JSON.parse(d.content) : d; setStyles(Array.isArray(s) ? s : []); } catch { /* */ }
        }
        if (snippetsRes?.ok) {
          try { const snips = await snippetsRes.json(); const list = snips.snippets || snips; setSnippetNames(list.map((s: { name: string }) => s.name)); } catch { /* */ }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [filePath]);

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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
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
