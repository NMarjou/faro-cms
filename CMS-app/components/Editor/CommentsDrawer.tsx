"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CommentReply {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  highlightedText: string;
  text: string;
  author: string;
  createdAt: string;
  resolved: boolean;
  replies: CommentReply[];
}

interface CommentsDrawerProps {
  editor: Editor;
  open: boolean;
  onClose: () => void;
  comments: Comment[];
  onAddComment: (comment: Comment) => void;
  onUpdateComment: (comment: Comment) => void;
  onDeleteComment: (commentId: string) => void;
  activeCommentId: string | null;
  onSetActiveComment: (id: string | null) => void;
  /** Text currently selected in the editor — used for new comments */
  pendingHighlight: string | null;
  onClearPending: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function generateId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CommentsDrawer({
  editor,
  open,
  onClose,
  comments,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  activeCommentId,
  onSetActiveComment,
  pendingHighlight,
  onClearPending,
}: CommentsDrawerProps) {
  const [newText, setNewText] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const newInputRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // Focus new comment input when pending highlight arrives
  useEffect(() => {
    if (pendingHighlight && open) {
      setTimeout(() => newInputRef.current?.focus(), 100);
    }
  }, [pendingHighlight, open]);

  // Scroll to active comment
  useEffect(() => {
    if (activeCommentId && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeCommentId]);

  const handleAddComment = useCallback(() => {
    if (!newText.trim() || !pendingHighlight) return;

    const id = generateId();
    const comment: Comment = {
      id,
      highlightedText: pendingHighlight,
      text: newText.trim(),
      author: "You",
      createdAt: new Date().toISOString(),
      resolved: false,
      replies: [],
    };

    // Apply the mark to the selected text
    editor.chain().focus().setCommentMark({ commentId: id }).run();

    onAddComment(comment);
    setNewText("");
    onClearPending();
    onSetActiveComment(id);
  }, [newText, pendingHighlight, editor, onAddComment, onClearPending, onSetActiveComment]);

  const handleAddReply = useCallback((commentId: string) => {
    if (!replyText.trim()) return;
    const comment = comments.find((c) => c.id === commentId);
    if (!comment) return;

    const reply: CommentReply = {
      id: generateId(),
      author: "You",
      text: replyText.trim(),
      createdAt: new Date().toISOString(),
    };

    onUpdateComment({
      ...comment,
      replies: [...comment.replies, reply],
    });
    setReplyText("");
    setReplyingTo(null);
  }, [replyText, comments, onUpdateComment]);

  const handleResolve = useCallback((commentId: string) => {
    const comment = comments.find((c) => c.id === commentId);
    if (!comment) return;
    onUpdateComment({ ...comment, resolved: !comment.resolved });
  }, [comments, onUpdateComment]);

  const handleDelete = useCallback((commentId: string) => {
    // Remove the highlight mark from the editor
    editor.chain().focus().unsetCommentMark(commentId).run();
    onDeleteComment(commentId);
    if (activeCommentId === commentId) onSetActiveComment(null);
  }, [editor, onDeleteComment, activeCommentId, onSetActiveComment]);

  const handleSaveEdit = useCallback((commentId: string) => {
    if (!editText.trim()) return;
    const comment = comments.find((c) => c.id === commentId);
    if (!comment) return;
    onUpdateComment({ ...comment, text: editText.trim() });
    setEditingId(null);
    setEditText("");
  }, [editText, comments, onUpdateComment]);

  const handleClickComment = useCallback((commentId: string) => {
    onSetActiveComment(commentId);
    // Scroll editor to the highlighted text
    const markType = editor.state.schema.marks.commentMark;
    if (!markType) return;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      const mark = node.marks.find(
        (m) => m.type === markType && m.attrs.commentId === commentId
      );
      if (mark) {
        editor.commands.setTextSelection({ from: pos, to: pos + node.nodeSize });
        editor.commands.scrollIntoView();
        return false; // stop walking
      }
    });
  }, [editor, onSetActiveComment]);

  const activeComments = comments.filter((c) => !c.resolved);
  const resolvedComments = comments.filter((c) => c.resolved);
  const displayComments = showResolved ? resolvedComments : activeComments;

  return (
    <div className={`comments-drawer${open ? " open" : ""}`}>
      {/* Header */}
      <div className="comments-drawer-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Comments</span>
          {activeComments.length > 0 && (
            <span className="comments-badge">{activeComments.length}</span>
          )}
        </div>
        <button onClick={onClose} className="comments-close-btn" title="Close">
          &times;
        </button>
      </div>

      {/* Tab bar */}
      <div className="comments-tabs">
        <button
          className={`comments-tab${!showResolved ? " active" : ""}`}
          onClick={() => setShowResolved(false)}
        >
          Open ({activeComments.length})
        </button>
        <button
          className={`comments-tab${showResolved ? " active" : ""}`}
          onClick={() => setShowResolved(true)}
        >
          Resolved ({resolvedComments.length})
        </button>
      </div>

      {/* New comment form */}
      {pendingHighlight && !showResolved && (
        <div className="comments-new">
          <div className="comments-new-highlight">
            &ldquo;{pendingHighlight.length > 80
              ? pendingHighlight.slice(0, 80) + "..."
              : pendingHighlight}&rdquo;
          </div>
          <textarea
            ref={newInputRef}
            className="comments-textarea"
            rows={3}
            placeholder="Add a comment..."
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleAddComment();
              }
              if (e.key === "Escape") {
                onClearPending();
                setNewText("");
              }
            }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              className="comments-btn-secondary"
              onClick={() => { onClearPending(); setNewText(""); }}
            >
              Cancel
            </button>
            <button
              className="comments-btn-primary"
              disabled={!newText.trim()}
              onClick={handleAddComment}
            >
              Comment
            </button>
          </div>
        </div>
      )}

      {/* Comment list */}
      <div className="comments-list">
        {displayComments.length === 0 && (
          <div className="comments-empty">
            {showResolved
              ? "No resolved comments"
              : "No comments yet. Select text and click the comment button to add one."}
          </div>
        )}
        {displayComments.map((comment) => {
          const isActive = activeCommentId === comment.id;
          const isEditing = editingId === comment.id;

          return (
            <div
              key={comment.id}
              ref={isActive ? activeRef : undefined}
              className={`comments-card${isActive ? " active" : ""}${comment.resolved ? " resolved" : ""}`}
              onClick={() => handleClickComment(comment.id)}
            >
              {/* Highlighted text excerpt */}
              <div className="comments-excerpt">
                &ldquo;{comment.highlightedText.length > 60
                  ? comment.highlightedText.slice(0, 60) + "..."
                  : comment.highlightedText}&rdquo;
              </div>

              {/* Comment body */}
              <div className="comments-body">
                <div className="comments-meta">
                  <span className="comments-author">{comment.author}</span>
                  <span className="comments-time">{timeAgo(comment.createdAt)}</span>
                </div>
                {isEditing ? (
                  <div style={{ marginTop: 4 }}>
                    <textarea
                      className="comments-textarea"
                      rows={2}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          handleSaveEdit(comment.id);
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                    />
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginTop: 4 }}>
                      <button className="comments-btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                      <button className="comments-btn-primary" onClick={() => handleSaveEdit(comment.id)}>Save</button>
                    </div>
                  </div>
                ) : (
                  <p className="comments-text">{comment.text}</p>
                )}
              </div>

              {/* Replies */}
              {comment.replies.length > 0 && (
                <div className="comments-replies">
                  {comment.replies.map((reply) => (
                    <div key={reply.id} className="comments-reply">
                      <div className="comments-meta">
                        <span className="comments-author">{reply.author}</span>
                        <span className="comments-time">{timeAgo(reply.createdAt)}</span>
                      </div>
                      <p className="comments-text">{reply.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply form */}
              {replyingTo === comment.id && (
                <div style={{ padding: "0 12px 8px" }}>
                  <textarea
                    className="comments-textarea"
                    rows={2}
                    placeholder="Reply..."
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleAddReply(comment.id);
                      }
                      if (e.key === "Escape") { setReplyingTo(null); setReplyText(""); }
                    }}
                    autoFocus
                  />
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginTop: 4 }}>
                    <button className="comments-btn-secondary" onClick={() => { setReplyingTo(null); setReplyText(""); }}>Cancel</button>
                    <button className="comments-btn-primary" disabled={!replyText.trim()} onClick={() => handleAddReply(comment.id)}>Reply</button>
                  </div>
                </div>
              )}

              {/* Actions */}
              {!isEditing && (
                <div className="comments-actions">
                  {!comment.resolved && (
                    <button
                      className="comments-action-btn"
                      onClick={(e) => { e.stopPropagation(); setReplyingTo(replyingTo === comment.id ? null : comment.id); setReplyText(""); }}
                    >
                      Reply
                    </button>
                  )}
                  {!comment.resolved && comment.author === "You" && (
                    <button
                      className="comments-action-btn"
                      onClick={(e) => { e.stopPropagation(); setEditingId(comment.id); setEditText(comment.text); }}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    className="comments-action-btn"
                    onClick={(e) => { e.stopPropagation(); handleResolve(comment.id); }}
                  >
                    {comment.resolved ? "Re-open" : "Resolve"}
                  </button>
                  <button
                    className="comments-action-btn danger"
                    onClick={(e) => { e.stopPropagation(); handleDelete(comment.id); }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
