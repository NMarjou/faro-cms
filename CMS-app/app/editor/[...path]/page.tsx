"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import type { JSONContent } from "@tiptap/react";
import dynamic from "next/dynamic";
import Icon from "@/components/Icon";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import type {
  Variables,
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

const ReviewDrawer = dynamic(() => import("@/components/Editor/ReviewDrawer"), {
  ssr: false,
});

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const pathSegments = params.path as string[];
  const filePath = pathSegments.map(decodeURIComponent).join("/");
  const { role, loaded: userLoaded } = useCurrentUser();
  // Default to "contributor" while the identity is still resolving — gives
  // contributors a stable read-only mount instead of a brief editable flash
  // and prevents the tech-writer toolbar from appearing for a frame. Tech
  // writers see the full toolbar as soon as their role lands.
  const isContributor = !userLoaded || role === "contributor";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Warning banner used for "soft" blocks that aren't errors — e.g. the
  // mark-review-done gate fires when comments/suggestions are still open.
  // Distinct from `error` so we can render in warning (not danger) color
  // and share a single banner between contributor and tech-writer flows.
  const [warning, setWarning] = useState<string | null>(null);
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

  // Send-for-review drawer state
  const [showReviewDrawer, setShowReviewDrawer] = useState(false);

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

    // Fire requests in parallel so the editor can mount as soon as the
    // article body resolves. Metadata streams in afterwards and the Toolbar
    // updates when props change. The 5 toolbar-metadata reads are bundled
    // into /api/editor-meta to dodge the browser 6-connection limit and
    // per-route dev-compile cost.
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
        if (found) {
          setArticleMeta(found);
          setOriginalMeta({ ...found });
        }
      } catch { /* */ }
    });

    metaPromise.then(async (res) => {
      if (!res?.ok) return;
      try {
        const meta = await res.json();
        setVariables(meta.variables || {});
        setConditionTags(meta.conditions?.tags || []);
        setConditionColors(meta.conditions?.colors || {});
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

      // Update lastModified in TOC. Saving body content after a sign-off
      // also clears the sign-off — the article has effectively changed
      // since the tech writer approved it, so it must be re-signed before
      // publish. Reset the local articleMeta to match.
      let clearedSignoff = false;
      if (articleMeta) {
        const tocRes = await fetch("/api/toc");
        if (tocRes.ok) {
          const toc = await tocRes.json();
          const art = findArticleInToc(toc, filePath);
          if (art) {
            art.lastModified = new Date().toISOString().split("T")[0];
            if (art.reviewComplete) {
              delete art.reviewComplete;
              delete art.reviewCompletedBy;
              delete art.reviewCompletedAt;
              clearedSignoff = true;
            }
            await fetch("/api/toc", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ toc }),
            });
          }
        }
      }

      if (clearedSignoff) {
        setArticleMeta((p) =>
          p
            ? {
                ...p,
                reviewComplete: undefined,
                reviewCompletedBy: undefined,
                reviewCompletedAt: undefined,
              }
            : p
        );
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
    // Local gate: this article was sent for review and isn't signed off
    // yet — bail before we save+publish. The server-side gate in
    // /api/publish covers other articles on the working branch and the
    // edge case where saving (just below) clears `reviewComplete`.
    if (
      articleMeta?.assignedTo &&
      articleMeta.assignedTo.length > 0 &&
      !articleMeta.reviewComplete
    ) {
      setError("This article is in review. Sign off before publishing.");
      return;
    }
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

  /**
   * Format the gate-blocked message so the verb matches the role's action
   * label ("mark review done" for contributor, "sign off" for tech-writer).
   */
  const formatBlockedMessage = (
    action: "mark review done" | "sign off",
    unresolvedComments: number,
    pendingSuggestions: number
  ): string => {
    const parts: string[] = [];
    if (unresolvedComments > 0) {
      parts.push(
        `${unresolvedComments} unresolved comment${unresolvedComments === 1 ? "" : "s"}`
      );
    }
    if (pendingSuggestions > 0) {
      parts.push(
        `${pendingSuggestions} pending suggestion${pendingSuggestions === 1 ? "" : "s"}`
      );
    }
    return parts.length === 0
      ? `Cannot ${action} — items are still outstanding.`
      : `Cannot ${action} — resolve ${parts.join(" and ")} first.`;
  };

  /**
   * Tech-writer's article-level review sign-off. Calls /api/article/review-done
   * which validates outstanding comments + suggestions server-side. A 409
   * here is a "soft" block — render the warning banner with counts instead
   * of the danger error banner.
   */
  const handleTechWriterToggleReviewDone = async () => {
    const senderEmail =
      typeof window !== "undefined"
        ? localStorage.getItem("cms-current-user") || undefined
        : undefined;
    if (!senderEmail) {
      setError("No active identity. Set yourself in Settings first.");
      return;
    }
    setWarning(null);
    setError(null);
    const currentlyComplete = articleMeta?.reviewComplete === true;
    try {
      const res = await fetch("/api/article/review-done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          reviewerEmail: senderEmail,
          done: !currentlyComplete,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setWarning(
          formatBlockedMessage(
            "sign off",
            data.unresolvedComments ?? 0,
            data.pendingSuggestions ?? 0
          )
        );
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || "Failed to update review status");
      }
      setArticleMeta((p) =>
        p
          ? {
              ...p,
              reviewComplete: data.reviewComplete || undefined,
              reviewCompletedBy: data.reviewCompletedBy,
              reviewCompletedAt: data.reviewCompletedAt,
            }
          : p
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update review status");
    }
  };

  /**
   * Contributor's mark-done block-callback. Editor.tsx hits it after the API
   * gates the action so the warning surfaces in the same banner the
   * tech-writer sees.
   */
  const handleMarkReviewDoneBlocked = useCallback(
    (unresolvedComments: number, pendingSuggestions: number) => {
      setError(null);
      setWarning(
        formatBlockedMessage("mark review done", unresolvedComments, pendingSuggestions)
      );
    },
    []
  );

  // Persist updated assignment list and fan out review notifications via the
  // dedicated share endpoint. The endpoint handles the TOC write, diffs the
  // previous reviewer set, and only emails the newly-added ones.
  const handleAssignmentSave = async (emails: string[]) => {
    const senderEmail =
      typeof window !== "undefined"
        ? localStorage.getItem("cms-current-user") || undefined
        : undefined;

    const res = await fetch("/api/article/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, emails, senderEmail }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to save assignment");
    }
    // Reflect the new state locally so the drawer's next open shows the right
    // pre-selection without a page reload.
    setArticleMeta((p) => (p ? { ...p, assignedTo: emails.length > 0 ? emails : undefined } : p));
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
          {/* Review-done indicator. Shows to anyone who opens the article:
              the contributor sees their own status mirrored from the
              toolbar; the tech writer sees which reviewers have signed off. */}
          {articleMeta?.reviewsDone && articleMeta.reviewsDone.length > 0 && (
            <span
              className="badge"
              style={{
                background: "var(--success-light)",
                color: "var(--success)",
                border: "1px solid var(--success)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
              title={`Review done by: ${articleMeta.reviewsDone.join(", ")}`}
            >
              ✓ Review done
              {articleMeta.assignedTo && articleMeta.assignedTo.length > 0 && (
                <span style={{ opacity: 0.8, fontWeight: 500 }}>
                  ({articleMeta.reviewsDone.length}/{articleMeta.assignedTo.length})
                </span>
              )}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setShowMeta((p) => !p)}
            className={`btn btn-sm${showMeta ? " btn-primary" : ""}`}
            title="Article metadata"
          >
            Meta
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="btn btn-icon"
            aria-label={saving ? "Saving" : "Save"}
            title={saving ? "Saving…" : isDirty ? "Save (Cmd/Ctrl+S)" : "No unsaved changes"}
            style={{
              opacity: saving || !isDirty ? 0.5 : 1,
              borderColor: isDirty ? "var(--accent)" : undefined,
            }}
          >
            <Icon name="floppy-disk" size={16} />
          </button>
          {/* Hide Send for Review once the article is signed off AND there
              are no unsaved edits — a clean sign-off state means no new
              changes need contributor input. The moment the tech writer
              starts typing (isDirty=true) the button reappears so they
              can request a new review round if the changes warrant it. */}
          {!isSnippet &&
            articleMeta &&
            !isContributor &&
            !(articleMeta.reviewComplete && !isDirty) && (
              <button
                onClick={() => setShowReviewDrawer(true)}
                className="btn"
                title="Share this article with a contributor for review"
              >
                Send for Review{articleMeta.assignedTo && articleMeta.assignedTo.length > 0
                  ? ` (${articleMeta.assignedTo.length})`
                  : ""}
              </button>
            )}
          {/* Tech-writer's article-level sign-off. Only visible when the
              article was actually sent for review. Mirrors the contributor's
              "Mark as done" visual language with the same gold/check
              styling so "complete this review round" reads consistently. */}
          {!isSnippet &&
            articleMeta &&
            !isContributor &&
            articleMeta.assignedTo &&
            articleMeta.assignedTo.length > 0 &&
            (articleMeta.reviewComplete ? (
              <button
                onClick={handleTechWriterToggleReviewDone}
                title="Reopen the review (re-enables comments and suggestions)"
                className="btn btn-inline-icon btn-review-done"
              >
                <Icon name="check-circle" weight="fill" size={16} />
                Signed off
              </button>
            ) : (
              <button
                onClick={handleTechWriterToggleReviewDone}
                title="Approve this article for publish — distinct from a contributor's per-reviewer mark-as-done"
                className="btn btn-gold btn-inline-icon"
              >
                <Icon name="check" weight="bold" size={16} />
                Sign off
              </button>
            ))}
          {!isContributor && (
            <button onClick={handlePublish} className="btn btn-primary">Publish</button>
          )}
        </div>
      </header>
      {!isSnippet && articleMeta && (
        <ReviewDrawer
          open={showReviewDrawer}
          onClose={() => setShowReviewDrawer(false)}
          initialAssigned={articleMeta.assignedTo || []}
          articleTitle={articleMeta.title}
          onSave={handleAssignmentSave}
        />
      )}
      <div className="main-body article-editor">
        {/* Contributor-facing banner: surfaces the tech writer's sign-off
            so contributors understand why Suggest Changes disappeared. */}
        {!isSnippet && isContributor && articleMeta?.reviewComplete && (
          <div
            style={{
              background: "var(--success-light, var(--info-light))",
              color: "var(--success, var(--info))",
              padding: "10px 16px",
              borderRadius: "var(--radius)",
              marginBottom: 16,
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Icon name="check-circle" weight="fill" size={16} />
            <span>
              The tech writer has signed off this article&apos;s review.
              {articleMeta.reviewCompletedBy ? ` Signed off by ${articleMeta.reviewCompletedBy}.` : ""}
            </span>
          </div>
        )}
        {warning && (
          <div
            style={{
              background: "var(--warning-light)",
              color: "var(--warning)",
              padding: "10px 16px",
              borderRadius: "var(--radius)",
              marginBottom: 16,
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span>{warning}</span>
            <button
              onClick={() => setWarning(null)}
              aria-label="Dismiss"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--warning)",
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
              }}
            >
              &times;
            </button>
          </div>
        )}
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
        {viewMode === "visual" && !userLoaded && (
          <div style={{ padding: 24, color: "var(--fg-muted)", fontSize: 13 }}>
            Loading editor…
          </div>
        )}
        {viewMode === "visual" && userLoaded && (
          <Editor
            filePath={filePath}
            assignedTo={articleMeta?.assignedTo}
            reviewsDone={articleMeta?.reviewsDone}
            reviewComplete={articleMeta?.reviewComplete}
            onReviewDoneChanged={(next) =>
              setArticleMeta((p) =>
                p ? { ...p, reviewsDone: next.length > 0 ? next : undefined } : p
              )
            }
            onMarkReviewDoneBlocked={handleMarkReviewDoneBlocked}
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
            mode={isContributor ? "review" : "full"}
            // Editor.tsx owns the unified ReviewSidebar + handler internally;
            // we don't pass onSuggestChanges so the internal handler wins.
            // Contributors get no source-view toggle — they shouldn't see raw HTML.
            viewMode={isContributor ? undefined : viewMode}
            onViewModeChange={isContributor ? undefined : (mode) => {
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
