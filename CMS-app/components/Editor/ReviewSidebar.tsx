"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor as TipTapEditor } from "@tiptap/react";
import type { Suggestion } from "@/lib/types";
import Icon from "../Icon";
import CommentsDrawer, { type Comment } from "./CommentsDrawer";

export type ReviewTab = "comments" | "suggestions";

interface ReviewSidebarProps {
  open: boolean;
  onClose: () => void;
  activeTab: ReviewTab;
  onChangeTab: (tab: ReviewTab) => void;

  // Comments tab — straight through to the embedded CommentsDrawer
  editor: TipTapEditor;
  comments: Comment[];
  onAddComment: (c: Comment) => void;
  onUpdateComment: (c: Comment) => void;
  onDeleteComment: (id: string) => void;
  activeCommentId: string | null;
  onSetActiveComment: (id: string | null) => void;
  pendingHighlight: string | null;
  onClearPending: () => void;
  authorLabel?: string;

  // Suggestions tab
  suggestions: Suggestion[];
  pendingSuggestion: { text: string; occurrenceIndex: number } | null;
  onSubmitSuggestion: (data: { suggestedText: string; note: string }) => Promise<void>;
  onClearPendingSuggestion: () => void;
  /** Tech writer can accept/reject. Contributor sees the list but no actions. */
  canResolveSuggestions?: boolean;
  onResolveSuggestion?: (id: string, action: "accept" | "reject") => Promise<void>;
  /** Suggestion to scroll into view + pulse. Cleared after the focus lands. */
  activeSuggestionId?: string | null;
  onClearActiveSuggestion?: () => void;
}

/**
 * Right-side drawer with two tabs — Comments and Suggested changes.
 * Shared chrome (positioned panel + backdrop + close button). The Comments
 * tab embeds the existing CommentsDrawer; the Suggested changes tab is
 * implemented inline below.
 *
 * Both tabs follow the same pattern: an optional "new" form at the top
 * (shown only when the editor has a relevant pending highlight), then a
 * list of items already on the article so the contributor can see their
 * submission land and add more without leaving the drawer.
 */
export default function ReviewSidebar({
  open,
  onClose,
  activeTab,
  onChangeTab,
  editor,
  comments,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  activeCommentId,
  onSetActiveComment,
  pendingHighlight,
  onClearPending,
  authorLabel,
  suggestions,
  pendingSuggestion,
  onSubmitSuggestion,
  onClearPendingSuggestion,
  canResolveSuggestions = false,
  onResolveSuggestion,
  activeSuggestionId,
  onClearActiveSuggestion,
}: ReviewSidebarProps) {
  if (!open) return null;

  const openComments = comments.filter((c) => !c.resolved).length;
  const pendingSuggestions = suggestions.filter((s) => s.status === "pending").length;

  return (
    <>
      <div onClick={onClose} className="review-backdrop" />
      <aside className="review-sidebar">
        <header className="review-sidebar-header">
          <h3>Review</h3>
          <button onClick={onClose} title="Close" className="review-sidebar-close">
            <Icon name="x" size={14} />
          </button>
        </header>

        {/* Tab bar */}
        <div role="tablist" className="review-tabs">
          <TabButton
            label="Comments"
            badge={openComments}
            active={activeTab === "comments"}
            onClick={() => onChangeTab("comments")}
          />
          <TabButton
            label="Suggested changes"
            badge={pendingSuggestions}
            active={activeTab === "suggestions"}
            onClick={() => onChangeTab("suggestions")}
          />
        </div>

        {/* Comments tab */}
        {activeTab === "comments" && (
          <CommentsDrawer
            embedded
            open={true}
            onClose={onClose}
            editor={editor}
            comments={comments}
            onAddComment={onAddComment}
            onUpdateComment={onUpdateComment}
            onDeleteComment={onDeleteComment}
            activeCommentId={activeCommentId}
            onSetActiveComment={onSetActiveComment}
            pendingHighlight={pendingHighlight}
            onClearPending={onClearPending}
            authorLabel={authorLabel}
          />
        )}

        {/* Suggested changes tab */}
        {activeTab === "suggestions" && (
          <SuggestionsTabBody
            pendingSuggestion={pendingSuggestion}
            onSubmit={onSubmitSuggestion}
            onClearPending={onClearPendingSuggestion}
            suggestions={suggestions}
            authorEmail={authorLabel}
            canResolve={canResolveSuggestions}
            onResolve={onResolveSuggestion}
            activeSuggestionId={activeSuggestionId}
            onClearActive={onClearActiveSuggestion}
          />
        )}
      </aside>
    </>
  );
}

function TabButton({
  label,
  badge,
  active,
  onClick,
}: {
  label: string;
  badge: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`review-tab${active ? " active" : ""}`}
    >
      {label}
      {badge > 0 && <span className="review-tab-badge">{badge}</span>}
    </button>
  );
}

/**
 * Suggested changes tab body — new-suggestion form at the top when there's
 * a pending highlight, list of existing suggestions below.
 */
function SuggestionsTabBody({
  pendingSuggestion,
  onSubmit,
  onClearPending,
  suggestions,
  authorEmail,
  canResolve,
  onResolve,
  activeSuggestionId,
  onClearActive,
}: {
  pendingSuggestion: { text: string; occurrenceIndex: number } | null;
  onSubmit: (data: { suggestedText: string; note: string }) => Promise<void>;
  onClearPending: () => void;
  suggestions: Suggestion[];
  authorEmail?: string;
  canResolve?: boolean;
  onResolve?: (id: string, action: "accept" | "reject") => Promise<void>;
  activeSuggestionId?: string | null;
  onClearActive?: () => void;
}) {
  const [suggested, setSuggested] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset + focus whenever a new pending highlight arrives.
  useEffect(() => {
    if (pendingSuggestion) {
      setSuggested(pendingSuggestion.text);
      setNote("");
      setError(null);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      });
    }
  }, [pendingSuggestion]);

  const handleSubmit = async () => {
    if (!pendingSuggestion) return;
    const trimmed = suggested.trim();
    if (!trimmed) {
      setError("Suggested text can't be empty");
      return;
    }
    if (trimmed === pendingSuggestion.text.trim()) {
      setError("Suggested text is identical to the original");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ suggestedText: suggested, note });
      // Reset for the next suggestion. We DON'T close the drawer — the
      // contributor sees their submission appear in the list below and can
      // immediately highlight new text to start another.
      setSuggested("");
      setNote("");
      onClearPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const pendingList = suggestions.filter((s) => s.status === "pending");
  const resolvedList = suggestions.filter((s) => s.status !== "pending");

  return (
    <div className="suggestions-tab-body">
      {/* New suggestion form */}
      {pendingSuggestion && (
        <div className="suggestion-form">
          <div>
            <div className="faro-label faro-label-pad">Original</div>
            <div className="suggestion-original">{pendingSuggestion.text}</div>
          </div>
          <div>
            <div className="faro-label faro-label-pad">Your suggestion</div>
            <textarea
              ref={textareaRef}
              className="input suggestion-textarea"
              value={suggested}
              onChange={(e) => setSuggested(e.target.value)}
              rows={4}
              placeholder="Edit the span…"
            />
          </div>
          <div>
            <div className="faro-label faro-label-pad">Note (optional)</div>
            <textarea
              className="input suggestion-note-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Why this change?"
            />
          </div>
          {error && <div className="suggestion-form-error">{error}</div>}
          <div className="suggestion-form-actions">
            <button onClick={() => { setSuggested(""); setNote(""); onClearPending(); }} className="btn btn-sm" disabled={submitting}>
              Discard
            </button>
            <button onClick={handleSubmit} className="btn btn-sm btn-gold" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit changes"}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="suggestions-list">
        {!pendingSuggestion && suggestions.length === 0 && (
          <p className="suggestions-empty">
            No suggestions yet. Highlight a span of text in the article to start one.
          </p>
        )}
        {pendingList.length > 0 && (
          <>
            <div className="faro-section-label review-list-group-label">Pending ({pendingList.length})</div>
            <div className="review-list-group">
              {pendingList.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  mine={authorEmail ? s.author === authorEmail : false}
                  canResolve={canResolve}
                  onResolve={onResolve}
                  active={activeSuggestionId === s.id}
                  onClearActive={onClearActive}
                />
              ))}
            </div>
          </>
        )}
        {resolvedList.length > 0 && (
          <>
            <div className="faro-section-label review-list-group-label">Resolved ({resolvedList.length})</div>
            <div className="review-list-group">
              {resolvedList.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  mine={authorEmail ? s.author === authorEmail : false}
                  active={activeSuggestionId === s.id}
                  onClearActive={onClearActive}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion: s,
  mine,
  canResolve,
  onResolve,
  active = false,
  onClearActive,
}: {
  suggestion: Suggestion;
  mine: boolean;
  canResolve?: boolean;
  onResolve?: (id: string, action: "accept" | "reject") => Promise<void>;
  active?: boolean;
  onClearActive?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // When the editor signals this is the active suggestion (user clicked the
  // highlight), scroll it into view and let the pulse animation play. We
  // clear `active` after a beat so re-clicking the same span retriggers it.
  useEffect(() => {
    if (!active || !cardRef.current) return;
    cardRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setExpanded(true);
    const t = setTimeout(() => onClearActive?.(), 1500);
    return () => clearTimeout(t);
  }, [active, onClearActive]);
  const [resolving, setResolving] = useState<null | "accept" | "reject">(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const handleResolve = async (action: "accept" | "reject") => {
    if (!onResolve) return;
    setResolving(action);
    setResolveError(null);
    try {
      await onResolve(s.id, action);
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : "Failed");
    } finally {
      setResolving(null);
    }
  };
  return (
    <div ref={cardRef} className={`suggestion-card${active ? " active" : ""}`}>
      {/* Header row — author / YOU pill / timestamp / expand-collapse toggle */}
      <div className="suggestion-card-meta">
        <span className="suggestion-card-author">{s.authorName || s.author}</span>
        {mine && <span className="suggestion-card-mine">YOU</span>}
        <span className="suggestion-card-date">{new Date(s.createdAt).toLocaleString()}</span>
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
          className="suggestion-card-expand-btn"
        >
          <Icon name={expanded ? "caret-up" : "caret-down"} weight="bold" size={12} />
        </button>
      </div>

      {/* Collapsed: single-line diff with ellipsis. Expanded: full original
          and suggested as separate paragraphs. Read-only either way — the
          tech writer's accept flow (Phase 3b) is the only thing that can
          apply or mutate a suggestion. */}
      {!expanded ? (
        <div className="suggestion-card-diff">
          <span className="diff-original">{s.originalText}</span>
          <span className="diff-arrow">→</span>
          <span className="diff-suggested">{s.suggestedText}</span>
        </div>
      ) : (
        <div className="suggestion-card-blocks">
          <div>
            <div className="faro-label faro-label-pad-sm">Original</div>
            <div className="suggestion-card-block is-original">{s.originalText}</div>
          </div>
          <div>
            <div className="faro-label faro-label-pad-sm">Suggested</div>
            <div className="suggestion-card-block is-suggested">{s.suggestedText}</div>
          </div>
        </div>
      )}

      {/* Note — always visible when present, but only the preview line is
          shown when collapsed. Expanded shows full wrapping. */}
      {s.note && (
        <div className={`suggestion-card-note ${expanded ? "expanded" : "collapsed"}`}>
          {s.note}
        </div>
      )}

      {s.status !== "pending" && (
        <div className={`suggestion-card-status ${s.status}`}>
          {s.status.toUpperCase()}
        </div>
      )}

      {/* Tech-writer accept / reject footer — only on pending suggestions */}
      {canResolve && s.status === "pending" && onResolve && (
        <div className="suggestion-card-actions">
          {resolveError && <div className="suggestion-card-error">{resolveError}</div>}
          <button
            onClick={() => handleResolve("reject")}
            className="btn btn-sm"
            disabled={!!resolving}
          >
            {resolving === "reject" ? "Rejecting…" : "Reject"}
          </button>
          <button
            onClick={() => handleResolve("accept")}
            className="btn btn-sm btn-inline-icon btn-review-done"
            disabled={!!resolving}
          >
            <Icon name="check" weight="bold" size={12} />
            {resolving === "accept" ? "Accepting…" : "Accept"}
          </button>
        </div>
      )}
    </div>
  );
}
