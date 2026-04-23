"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import type { JSONContent } from "@tiptap/react";
import dynamic from "next/dynamic";
import type {
  Variables,
  ConditionsConfig,
  GlossaryTerm,
  ContentStyle,
  TocArticle,
  Toc,
} from "@/lib/types";

/** Pretty-print HTML with indentation */
function formatHtml(html: string): string {
  const BLOCK_TAGS = new Set([
    "div", "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
    "blockquote", "pre", "hr", "br", "section", "article", "nav",
    "header", "footer", "main", "figure", "figcaption", "iframe",
  ]);

  let result = "";
  let indent = 0;
  const pad = () => "  ".repeat(indent);

  // Split into tags and text
  const tokens = html.split(/(<\/?[^>]+>)/g).filter(Boolean);

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("</")) {
      // Closing tag
      const tag = trimmed.match(/<\/(\w+)/)?.[1]?.toLowerCase() || "";
      if (BLOCK_TAGS.has(tag)) {
        indent = Math.max(0, indent - 1);
        result += `\n${pad()}${trimmed}`;
      } else {
        result += trimmed;
      }
    } else if (trimmed.startsWith("<")) {
      const tag = trimmed.match(/<(\w+)/)?.[1]?.toLowerCase() || "";
      const selfClosing = trimmed.endsWith("/>") || tag === "br" || tag === "hr";

      if (BLOCK_TAGS.has(tag)) {
        result += `\n${pad()}${trimmed}`;
        if (!selfClosing) indent++;
      } else {
        result += trimmed;
      }
    } else {
      // Text node
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

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const pathSegments = params.path as string[];
  const filePath = pathSegments.map(decodeURIComponent).join("/");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [articleMeta, setArticleMeta] = useState<TocArticle | null>(null);
  const [format, setFormat] = useState<"html" | "mdx">("html");
  const [initialContent, setInitialContent] = useState<JSONContent | null>(null);
  const [initialHtml, setInitialHtml] = useState<string>("");
  const [rawSource, setRawSource] = useState("");
  const [variables, setVariables] = useState<Variables>({});
  const [conditionTags, setConditionTags] = useState<string[]>([]);
  const [conditionColors, setConditionColors] = useState<Record<string, string>>({});
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTerm[]>([]);
  const [styles, setStyles] = useState<ContentStyle[]>([]);
  const [snippetNames, setSnippetNames] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const isSnippet = filePath.startsWith("snippets/");
  const [snippetTitle, setSnippetTitle] = useState<string | null>(null);
  const [publishUrl, setPublishUrl] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"visual" | "source">("visual");
  const [sourceHighlight, setSourceHighlight] = useState<string | undefined>(undefined);
  const [showMeta, setShowMeta] = useState(false);
  const [metaDirty, setMetaDirty] = useState(false);
  const [metaSaving, setMetaSaving] = useState(false);
  const [originalMeta, setOriginalMeta] = useState<TocArticle | null>(null);

  // Spell-check state
  const [showSpellCheck, setShowSpellCheck] = useState(false);
  const [spellChecking, setSpellChecking] = useState(false);
  const [spellIssues, setSpellIssues] = useState<{ word: string; suggestions: string[]; count: number }[]>([]);
  const [spellWordCount, setSpellWordCount] = useState(0);
  const [addedToDict, setAddedToDict] = useState<Set<string>>(new Set());

  const editorContentRef = useRef<JSONContent | null>(null);
  const editorRef = useRef<{ getHTML: () => string; getSelectedText: () => string; setContent: (html: string) => void } | null>(null);
  const loadedRef = useRef(false);
  const [autosaveInterval, setAutosaveInterval] = useState(120); // seconds
  const [lastAutoSaved, setLastAutoSaved] = useState<string | null>(null);
  const saveRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // Load autosave interval from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("cms-autosave-interval");
    if (saved) setAutosaveInterval(Number(saved));
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    async function load() {
      try {
        // Load article content
        const articleRes = await fetch(`/api/article?path=${encodeURIComponent(filePath)}`);
        if (!articleRes.ok) throw new Error("Failed to load article");
        const articleData = await articleRes.json();

        const isHtml = articleData.format === "html";
        setFormat(isHtml ? "html" : "mdx");

        if (isHtml) {
          // HTML: pass directly to TipTap
          setInitialHtml(articleData.content);
          setRawSource(articleData.content);
        } else {
          // MDX: parse via server API
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
            // Try HTML comment format: <!--name:My Snippet-->
            const raw = articleData.content || articleData.raw || "";
            const m = raw.match(/<!--\s*name:\s*(.+?)\s*-->/);
            if (m) setSnippetTitle(m[1]);
          }
        } else {
          const tocRes = await fetch("/api/toc");
          if (tocRes.ok) {
            const toc: Toc = await tocRes.json();
            const found = findArticleInToc(toc, filePath);
            if (found) {
              setArticleMeta(found);
              setOriginalMeta({ ...found });
            }
          }
        }

        // Load metadata in parallel
        const [varsRes, condsRes, glossaryRes, stylesRes, snippetsRes] = await Promise.all([
          fetch("/api/variables").catch(() => null),
          fetch("/api/content?path=conditions.json").catch(() => null),
          fetch("/api/glossary").catch(() => null),
          fetch("/api/content?path=styles.json").catch(() => null),
          fetch("/api/snippets").catch(() => null),
        ]);

        if (varsRes?.ok) setVariables(await varsRes.json());
        if (condsRes?.ok) {
          try {
            const d = await condsRes.json();
            const c: ConditionsConfig = d.content ? JSON.parse(d.content) : d;
            setConditionTags(c.tags || []);
            setConditionColors(c.colors || {});
          } catch { /* */ }
        }
        if (glossaryRes?.ok) {
          const g = await glossaryRes.json();
          setGlossaryTerms(g.terms || []);
        }
        if (stylesRes?.ok) {
          try {
            const d = await stylesRes.json();
            const s = d.content ? JSON.parse(d.content) : d;
            setStyles(Array.isArray(s) ? s : []);
          } catch { /* */ }
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
    // Get HTML from the editor ref or from the content ref
    if (editorRef.current) return editorRef.current.getHTML();
    return rawSource;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      let content: string;

      if (viewMode === "source") {
        content = rawSource;
      } else {
        // Always save as HTML from the editor
        content = getEditorHtml();
        setRawSource(content);
      }

      const res = await fetch("/api/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          content,
          message: `Update ${articleMeta?.title || filePath}`,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Save failed");
      }

      // Update lastModified in TOC
      if (articleMeta) {
        const tocRes = await fetch("/api/toc");
        if (tocRes.ok) {
          const toc = await tocRes.json();
          const art = findArticleInToc(toc, filePath);
          if (art) {
            art.lastModified = new Date().toISOString().split("T")[0];
            await fetch("/api/toc", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ toc }),
            });
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

  // Keep saveRef in sync so the timer can call the latest handleSave
  saveRef.current = handleSave;

  // Autosave timer
  useEffect(() => {
    if (autosaveInterval <= 0) return;
    const timer = setInterval(() => {
      // Only autosave if dirty and not already saving
      if (isDirty && !saving) {
        saveRef.current?.();
      }
    }, autosaveInterval * 1000);
    return () => clearInterval(timer);
  }, [autosaveInterval, isDirty, saving]);

  const handlePublish = async () => {
    await handleSave();
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Update: ${articleMeta?.title || filePath}`,
          description: `Content update for ${filePath}`,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Publish failed"); }
      const data = await res.json();
      setPublishUrl(data.prUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    }
  };

  const handleMetaSave = async () => {
    if (!articleMeta || !originalMeta) return;
    setMetaSaving(true);
    setError(null);

    try {
      const slugChanged = articleMeta.slug !== originalMeta.slug;
      const titleChanged = articleMeta.title !== originalMeta.title;
      const tagsChanged = JSON.stringify(articleMeta.tags) !== JSON.stringify(originalMeta.tags);

      if (slugChanged || titleChanged) {
        // Slug or title changed → use the article-move API (handles file rename + cascade link updates)
        // Save content first if dirty
        if (isDirty) await handleSave();

        const res = await fetch("/api/article-move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            oldFile: filePath,
            newSlug: articleMeta.slug,
            newTitle: articleMeta.title,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Move failed");
        }
        const result = await res.json();

        // Update original meta to reflect new state
        setOriginalMeta({ ...articleMeta });
        setMetaDirty(false);

        // If the file was actually moved, redirect to the new path
        if (result.fileChanged) {
          const msg = result.linksRewritten > 0
            ? `Article renamed. ${result.linksRewritten} link${result.linksRewritten !== 1 ? "s" : ""} updated in other articles.`
            : "Article renamed.";
          // Navigate to the new editor URL
          router.push(`/editor/${encodeURIComponent(result.newFile)}`);
          return;
        }
      } else if (tagsChanged) {
        // Only tags changed — update TOC directly
        const tocRes = await fetch("/api/toc");
        if (tocRes.ok) {
          const toc = await tocRes.json();
          const art = findArticleInToc(toc, filePath);
          if (art) {
            art.tags = articleMeta.tags;
            await fetch("/api/toc", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ toc, message: `Update tags for ${articleMeta.title}` }),
            });
          }
        }
        setOriginalMeta({ ...articleMeta });
        setMetaDirty(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Metadata save failed");
    } finally {
      setMetaSaving(false);
    }
  };

  const handleSpellCheck = async () => {
    setSpellChecking(true);
    setShowSpellCheck(true);
    try {
      const html = editorRef.current ? editorRef.current.getHTML() : rawSource;
      const res = await fetch("/api/qa/spellcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: html }),
      });
      if (!res.ok) throw new Error("Spell check failed");
      const data = await res.json();
      setSpellIssues(data.issues || []);
      setSpellWordCount(data.totalWords || 0);
    } catch {
      setSpellIssues([]);
    } finally {
      setSpellChecking(false);
    }
  };

  const handleAddWordToDict = async (word: string) => {
    try {
      const res = await fetch("/api/qa/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words: [word] }),
      });
      if (res.ok) {
        setAddedToDict((prev) => new Set([...prev, word.toLowerCase()]));
        // Remove from current issues
        setSpellIssues((prev) => prev.filter((i) => i.word.toLowerCase() !== word.toLowerCase()));
      }
    } catch { /* ignore */ }
  };

  const handleSpellReplace = (original: string, replacement: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    // Get the current HTML, replace the word in text content, and update editor
    const html = ed.getHTML();
    const regex = new RegExp(`\\b${original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const newHtml = html.replace(regex, replacement);
    if (newHtml !== html) {
      ed.setContent(newHtml);
      setRawSource(newHtml);
      setIsDirty(true);
      // Remove from issues
      setSpellIssues((prev) => prev.filter((i) => i.word.toLowerCase() !== original.toLowerCase()));
    }
  };

  if (loading) {
    return (
      <>
        <header className="main-header"><h1>Loading...</h1></header>
        <div className="main-body article-editor"><p>Loading article...</p></div>
      </>
    );
  }

  if (error && !initialHtml && !initialContent) {
    return (
      <>
        <header className="main-header"><h1>Error</h1></header>
        <div className="main-body article-editor"><div className="card" style={{ color: "var(--danger)" }}>{error}</div></div>
      </>
    );
  }

  const title = isSnippet ? (snippetTitle || filePath) : (articleMeta?.title || filePath);

  return (
    <>
      <header className="main-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push(isSnippet ? "/snippets" : "/articles")} className="btn btn-sm">Back</button>
          <h1 style={{ fontSize: 16 }}>{title}</h1>
          <span className="badge">{isSnippet ? "SNIPPET" : format.toUpperCase()}</span>
          {isDirty ? (
            <span className="badge" style={{ background: "var(--warning-light)", color: "var(--warning)" }}>Unsaved</span>
          ) : lastAutoSaved ? (
            <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>Saved {lastAutoSaved}</span>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setShowMeta((p) => !p)}
            className={`btn btn-sm${showMeta ? " btn-primary" : ""}`}
            title="Article metadata"
          >
            Meta
          </button>
          <button onClick={handleSave} disabled={saving || !isDirty} className="btn" style={{ opacity: saving || !isDirty ? 0.5 : 1, borderColor: isDirty ? "var(--accent)" : undefined }}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button onClick={handlePublish} className="btn btn-primary">Publish</button>
        </div>
      </header>
      <div className="main-body article-editor">
        {error && (
          <div style={{ background: "var(--danger-light)", color: "var(--danger)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>
            {error}
          </div>
        )}
        {publishUrl && (
          <div style={{ background: "var(--success-light)", color: "var(--success)", padding: "10px 16px", borderRadius: "var(--radius)", marginBottom: 16, fontSize: 14 }}>
            PR created: <a href={publishUrl} target="_blank" rel="noreferrer">{publishUrl}</a>
          </div>
        )}

        <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 12, fontFamily: "var(--font-mono)" }}>{filePath}</p>

        {/* Metadata drawer (right side) */}
        {showMeta && articleMeta && (
          <>
            {/* Backdrop */}
            <div
              onClick={() => setShowMeta(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.15)",
                zIndex: 900,
              }}
            />
            {/* Drawer */}
            <div style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: 380,
              maxWidth: "90vw",
              background: "var(--bg)",
              borderLeft: "1px solid var(--border)",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
              zIndex: 901,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid var(--border)",
              }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Article Metadata</h3>
                <button
                  onClick={() => setShowMeta(false)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 18,
                    color: "var(--fg-muted)",
                    padding: "2px 6px",
                    borderRadius: 4,
                    lineHeight: 1,
                  }}
                  title="Close"
                >
                  &times;
                </button>
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>Title</label>
                  <input className="input" value={articleMeta.title} onChange={(e) => { setArticleMeta((p) => p ? { ...p, title: e.target.value } : p); setMetaDirty(true); }} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>Slug</label>
                  <input className="input" value={articleMeta.slug} onChange={(e) => {
                    const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
                    setArticleMeta((p) => p ? { ...p, slug } : p);
                    setMetaDirty(true);
                  }} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>Format</label>
                  <span className="badge">{format.toUpperCase()}</span>
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>Last Modified</label>
                  <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>{articleMeta.lastModified || "Never"}</span>
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>Tags (comma-separated)</label>
                  <input className="input" value={(articleMeta.tags || []).join(", ")} onChange={(e) => { setArticleMeta((p) => p ? { ...p, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) } : p); setMetaDirty(true); }} />
                </div>
              </div>
              {metaDirty && (
                <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {originalMeta && articleMeta.slug !== originalMeta.slug && (
                    <span style={{ fontSize: 12, color: "var(--warning)", background: "rgba(245, 158, 11, 0.1)", padding: "2px 8px", borderRadius: "var(--radius)", width: "100%", marginBottom: 8 }}>
                      File will be renamed &amp; links in other articles will be updated
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  <button className="btn btn-sm" onClick={() => { setArticleMeta(originalMeta ? { ...originalMeta } : null); setMetaDirty(false); }}>
                    Cancel
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={handleMetaSave} disabled={metaSaving}>
                    {metaSaving ? "Saving..." : "Save Metadata"}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Editor or Source */}
        {viewMode === "visual" && (
          <Editor
            initialContent={format === "html" ? undefined : initialContent || undefined}
            initialHtml={format === "html" ? initialHtml : undefined}
            variables={variables}
            conditionTags={conditionTags}
            conditionColors={conditionColors}
            snippetNames={snippetNames}
            glossaryTerms={glossaryTerms}
            styles={styles}
            onChange={handleEditorChange}
            onSave={handleSave}
            onEditorReady={(editor) => { editorRef.current = { getHTML: () => editor.getHTML(), getSelectedText: () => editor.getSelectedText(), setContent: (html: string) => { editor.commands.setContent(html); } }; }}
            viewMode={viewMode}
            onViewModeChange={(mode) => {
              if (mode === "source") {
                const selectedText = editorRef.current?.getSelectedText() || "";
                if (isDirty) handleSave();
                if (editorRef.current) {
                  setRawSource(formatHtml(editorRef.current.getHTML()));
                }
                setSourceHighlight(selectedText || undefined);
              } else {
                if (isDirty) handleSave();
                setSourceHighlight(undefined);
              }
              setViewMode(mode);
            }}
            spellChecking={spellChecking}
            spellIssues={spellIssues}
            showSpellCheck={showSpellCheck}
            onSpellCheck={handleSpellCheck}
            onSpellReplace={handleSpellReplace}
            onSpellAddToDict={handleAddWordToDict}
            onSpellClose={() => setShowSpellCheck(false)}
            spellWordCount={spellWordCount}
            spellAddedCount={addedToDict.size}
          />
        )}
        {viewMode === "source" && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div style={{
              padding: "6px 12px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-muted)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <button
                onClick={() => {
                  if (isDirty) handleSave();
                  setSourceHighlight(undefined);
                  setViewMode("visual");
                }}
                className="btn btn-sm"
                style={{ fontSize: 11 }}
              >
                Back to visual editor
              </button>
              <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>Source editing mode</span>
            </div>
            <SourceView value={rawSource} onChange={handleSourceChange} highlightText={sourceHighlight} />
          </div>
        )}
      </div>
    </>
  );
}
