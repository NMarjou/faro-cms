/**
 * Server-side article workflow bookkeeping.
 *
 * When an article body is saved it has, by definition, changed — so any prior
 * tech-writer sign-off and the article's `lastModified` must be updated, and an
 * owner's pending submit-for-approval cleared. This used to be done by a client
 * `toc.json` write in the editor, but the authz layer makes `toc.json` writes
 * tech-writer-only — which silently 403'd for authors. Doing it here, inside
 * the already-authorized `/api/content` write, keeps the invariant enforced on
 * the server (not bypassable by the client) and works for every editor role.
 */

import { getFile, putFile } from "./storage";
import { findTocArticle } from "./server-auth";
import { ownsArticle } from "./permissions";
import type { Toc, User } from "./types";

/** Article bodies live as .mdx / .html / .htm; everything else is config/snippets/images. */
const ARTICLE_EXT = /\.(mdx|html?)$/i;

export interface SaveWorkflowResult {
  lastModified?: string;
  /** Tech-writer sign-off was reset because the body changed. */
  clearedSignoff?: boolean;
  /** Owner's pending submit-for-approval was reset because they edited it. */
  clearedApproval?: boolean;
}

/**
 * Sync the TOC entry after an article body save: bump `lastModified`, reset a
 * stale `reviewComplete` sign-off, and (when the saver owns the article) reset
 * a pending `approvalStatus`. No-op for non-article paths and for files not yet
 * registered in the TOC (brand-new articles). Returns what changed so the
 * client can mirror authoritative state without a refetch.
 */
export async function syncArticleWorkflowOnSave(
  path: string,
  user: User | null
): Promise<SaveWorkflowResult> {
  const p = path.replace(/^content\//, "");
  if (p.startsWith("snippets/") || p.startsWith("images/") || !ARTICLE_EXT.test(p)) {
    return {};
  }

  let toc: Toc;
  try {
    const file = await getFile("content/toc.json");
    toc = JSON.parse(file.content) as Toc;
  } catch {
    return {};
  }

  const article = findTocArticle(toc, p);
  if (!article) return {};

  const lastModified = new Date().toISOString().split("T")[0];
  article.lastModified = lastModified;

  let clearedSignoff = false;
  if (article.reviewComplete) {
    delete article.reviewComplete;
    delete article.reviewCompletedBy;
    delete article.reviewCompletedAt;
    clearedSignoff = true;
  }

  let clearedApproval = false;
  if (
    ownsArticle(article, user?.email) &&
    article.approvalStatus === "submitted"
  ) {
    delete article.approvalStatus;
    delete article.submittedBy;
    delete article.submittedAt;
    clearedApproval = true;
  }

  await putFile(
    "content/toc.json",
    JSON.stringify(toc, null, 2),
    `Update ${article.title}${clearedSignoff ? " (sign-off reset)" : ""}`
  );

  return { lastModified, clearedSignoff, clearedApproval };
}
