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
import { subpathToContent } from "./content-paths";
import type { Toc, TocArticle, TocCategory, TocSection, User } from "./types";

/** Article bodies live as .mdx / .html / .htm; everything else is config/snippets/images. */
const ARTICLE_EXT = /\.(mdx|html?)$/i;

export interface SaveWorkflowResult {
  lastModified?: string;
  /** Tech-writer sign-off was reset because the body changed. */
  clearedSignoff?: boolean;
  /** Owner's pending submit-for-approval was reset because they edited it. */
  clearedApproval?: boolean;
  /** Published flag was reset because the working copy diverged from what shipped. */
  clearedPublished?: boolean;
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

  // An edited article no longer matches what's live on the default branch, so
  // it shouldn't read as "Published" until it's published again.
  let clearedPublished = false;
  if (article.published) {
    delete article.published;
    delete article.publishedAt;
    clearedPublished = true;
  }

  await putFile(
    "content/toc.json",
    JSON.stringify(toc, null, 2),
    `Update ${article.title}${clearedSignoff ? " (sign-off reset)" : ""}`
  );

  return { lastModified, clearedSignoff, clearedApproval, clearedPublished };
}

/**
 * From a PR's changed repo paths, return the TOC `file` paths of article
 * bodies — content-relative (no "content/" prefix), e.g. "help/passport/x.mdx".
 * Maps each repo path back through the content-path layer so the project/shared
 * rooting (CMS-content/projects/<slug>/… and CMS-content/shared/…) is stripped,
 * then keeps only .mdx/.html/.htm, dropping toc.json/config (by extension),
 * snippets, and images.
 */
const REPO_CONTENT_PREFIX = "CMS-content/";
export function articleFilesFromRepoPaths(repoPaths: string[]): string[] {
  return repoPaths
    .filter((p) => p.startsWith(REPO_CONTENT_PREFIX))
    .map((p) => subpathToContent(p.slice(REPO_CONTENT_PREFIX.length))) // → content/help/x.mdx
    .map((p) => p.slice("content/".length)) // → help/x.mdx
    .filter(
      (p) =>
        /\.(mdx|html?)$/i.test(p) &&
        !p.startsWith("snippets/") &&
        !p.startsWith("images/")
    );
}

/**
 * Group a PR's changed article bodies by the PROJECT they belong to, so the
 * post-merge webhook can mark "published" in the right project's TOC (the
 * flat `articleFilesFromRepoPaths` throws the slug away). Keys are project
 * slugs; values are content-relative `file` paths (e.g. "help/x.mdx"). Only
 * project-scoped article bodies count — shared assets (CMS-content/shared/…),
 * snippet/image overrides, and toc.json/config are excluded.
 */
export function articleFilesByProject(repoPaths: string[]): Map<string, string[]> {
  const byProject = new Map<string, string[]>();
  for (const p of repoPaths) {
    if (!p.startsWith(REPO_CONTENT_PREFIX)) continue;
    const sub = p.slice(REPO_CONTENT_PREFIX.length); // projects/<slug>/<rel> | shared/… | <platform>
    if (!sub.startsWith("projects/")) continue; // only project content is publishable per-project
    const slug = sub.split("/")[1];
    if (!slug) continue;
    const file = subpathToContent(sub).slice("content/".length); // <rel>, e.g. help/x.mdx
    if (
      !ARTICLE_EXT.test(file) ||
      file.startsWith("snippets/") ||
      file.startsWith("images/")
    ) {
      continue;
    }
    (byProject.get(slug) ?? byProject.set(slug, []).get(slug)!).push(file);
  }
  return byProject;
}

/**
 * Mark articles published. Walks the TOC (categories → sections → subsections
 * + standalone) and sets `published: true` + `publishedAt` on every entry whose
 * `file` is in `files`. Returns the mutated TOC and the files it matched. Pure
 * over its inputs apart from mutating the passed TOC's entries — callers pass a
 * freshly-parsed TOC and write the result back.
 */
export function markPublishedInToc(
  toc: Toc,
  files: Set<string>,
  publishedAt: string
): { toc: Toc; marked: string[] } {
  const marked: string[] = [];
  const mark = (a: TocArticle) => {
    if (files.has(a.file)) {
      a.published = true;
      a.publishedAt = publishedAt;
      marked.push(a.file);
    }
  };
  for (const cat of toc.categories) {
    for (const sec of cat.sections) {
      sec.articles.forEach(mark);
      for (const sub of sec.subsections ?? []) sub.articles.forEach(mark);
    }
  }
  (toc.articles ?? []).forEach(mark);
  return { toc, marked };
}

// ── Publish gate ─────────────────────────────────────────────────────────────

/**
 * Whether an article still owes a tech-writer sign-off before it can publish.
 * An article enters a review track when it's sent for contributor review
 * (`assignedTo` non-empty) or submitted for approval by its author
 * (`approvalStatus === "submitted"`); either way it's cleared only by
 * `reviewComplete`. Articles in neither track never block. Single source of
 * truth for both the per-article and branch-wide publish gates.
 */
export function articleOwesSignoff(
  a: Pick<TocArticle, "reviewComplete" | "assignedTo" | "approvalStatus">
): boolean {
  if (a.reviewComplete === true) return false;
  return (a.assignedTo?.length ?? 0) > 0 || a.approvalStatus === "submitted";
}

// ── Per-article TOC merge (isolated publish) ─────────────────────────────────

/** Working-only scratch fields that must NOT ride along to the published TOC on main. */
const WORKFLOW_FIELDS: (keyof TocArticle)[] = [
  "assignedTo",
  "assignedBy",
  "reviewsDone",
  "reviewComplete",
  "reviewCompletedBy",
  "reviewCompletedAt",
  "approvalStatus",
  "submittedBy",
  "submittedAt",
];

/** A copy of the entry with review/approval scratch state stripped. */
function publishedEntry(a: TocArticle): TocArticle {
  const clone: TocArticle = { ...a };
  for (const f of WORKFLOW_FIELDS) delete clone[f];
  return clone;
}

function upsertInList(list: TocArticle[], entry: TocArticle): TocArticle[] {
  const idx = list.findIndex((a) => a.file === entry.file);
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = entry;
    return next;
  }
  return [...list, entry];
}

function ensureCategory(toc: Toc, from: TocCategory): TocCategory {
  let cat = toc.categories.find((c) => c.slug === from.slug);
  if (!cat) {
    cat = { name: from.name, slug: from.slug, description: from.description, icon: from.icon, sections: [] };
    toc.categories.push(cat);
  }
  return cat;
}

function ensureSection(cat: TocCategory, from: TocSection): TocSection {
  let sec = cat.sections.find((s) => s.slug === from.slug);
  if (!sec) {
    sec = { name: from.name, slug: from.slug, articles: [] };
    cat.sections.push(sec);
  }
  return sec;
}

function ensureSubsection(sec: TocSection, from: TocSection): TocSection {
  if (!sec.subsections) sec.subsections = [];
  let sub = sec.subsections.find((s) => s.slug === from.slug);
  if (!sub) {
    sub = { name: from.name, slug: from.slug, articles: [] };
    sec.subsections.push(sub);
  }
  return sub;
}

/**
 * Produce a copy of `mainToc` with `file`'s entry inserted (or replaced) at the
 * same category → section → (subsection) placement it occupies in `workingToc`,
 * creating any missing container by slug. Standalone articles (`toc.articles[]`)
 * are handled too. The published entry has workflow scratch fields stripped.
 * Returns `mainToc` unchanged if `file` isn't found in `workingToc`.
 */
export function upsertArticleIntoToc(
  mainToc: Toc,
  workingToc: Toc,
  file: string
): Toc {
  const article = findTocArticle(workingToc, file);
  if (!article) return mainToc;

  const entry = publishedEntry(article);
  const out: Toc = JSON.parse(JSON.stringify(mainToc)) as Toc;

  // Standalone (not in any category)?
  if (workingToc.articles?.some((a) => a.file === file)) {
    out.articles = upsertInList(out.articles ?? [], entry);
    return out;
  }

  for (const wCat of workingToc.categories) {
    for (const wSec of wCat.sections) {
      if (wSec.articles.some((a) => a.file === file)) {
        const sec = ensureSection(ensureCategory(out, wCat), wSec);
        sec.articles = upsertInList(sec.articles, entry);
        return out;
      }
      for (const wSub of wSec.subsections ?? []) {
        if (wSub.articles.some((a) => a.file === file)) {
          const sub = ensureSubsection(ensureSection(ensureCategory(out, wCat), wSec), wSub);
          sub.articles = upsertInList(sub.articles, entry);
          return out;
        }
      }
    }
  }

  // Found by findTocArticle but not located in the structure walk (shouldn't
  // happen) — fall back to standalone so the entry still reaches main.
  out.articles = upsertInList(out.articles ?? [], entry);
  return out;
}
