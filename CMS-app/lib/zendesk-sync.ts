import { createHash } from "crypto";
import type { Toc, TocSection } from "./types";
import type { ZendeskMap } from "./zendesk-map";
import type { ReconcilePlan, ReconcileNode } from "./zendesk-reconcile";

/**
 * Outbound sync: push the Faro TOC + articles INTO Zendesk.
 *
 * Two entry points share one shape:
 *   • buildSyncPlan — pure, no I/O. What WOULD happen: which categories/sections
 *     get created, which articles publish new / update / stay unchanged, what
 *     can't sync. This is the dry-run the user previews before the live run.
 *   • executeSync — does it, against an injected ZendeskWriter (real client in
 *     prod, mock in tests). Every created id is written back to the map and
 *     PERSISTED before the next dependent create, so a run that dies partway
 *     resumes without re-creating what already landed. (Not fully atomic: a
 *     crash in the narrow window between a Zendesk create and its persist loses
 *     that one id and would re-create it — Zendesk offers no idempotency key.)
 *
 * Guard: the sync refuses to run while any structural match is still unconfirmed
 * (matched/ambiguous) or broken (stale). Those must go through the review screen
 * first — otherwise an unconfirmed "matched" node would be CREATED here,
 * duplicating a category that already exists.
 */

// ── Article model ────────────────────────────────────────────────────────────

/** An article's identity + placement, no body — enough to plan. */
export interface PlannedArticle {
  file: string;
  title: string;
  /** Slug chain of its section, "cat/sec/sub". Empty ⇒ unfiled (can't sync). */
  sectionPath: string;
  /** Hash of (title + compiled body); unchanged hash ⇒ skip. */
  hash: string;
}

/** A planned article plus the compiled body and the images it references. */
export interface SyncArticle extends PlannedArticle {
  body: string;
  assets: string[];
}

/** Stable content hash — changes iff the reader-visible article changes. Hashed
 *  over the COMPILED body (pre image-rewrite), so uploaded attachment URLs (which
 *  differ every run) don't make an unchanged article look changed. */
export function hashArticle(title: string, body: string, sectionPath: string): string {
  return createHash("sha256")
    .update(title).update("\0").update(sectionPath).update("\0").update(body)
    .digest("hex").slice(0, 16);
}

/** Walk the TOC to each filed article with its section slug-path. Uncategorised
 *  articles (toc.articles) are returned separately — they have no Zendesk home. */
export function articlesWithSectionPaths(toc: Toc): {
  filed: { file: string; title: string; sectionPath: string }[];
  unfiled: string[];
} {
  const filed: { file: string; title: string; sectionPath: string }[] = [];
  const walk = (secs: TocSection[], trail: string[]) => {
    for (const sec of secs ?? []) {
      const path = [...trail, sec.slug].join("/");
      for (const a of sec.articles ?? []) filed.push({ file: a.file, title: a.title, sectionPath: path });
      if (sec.subsections) walk(sec.subsections, [...trail, sec.slug]);
    }
  };
  for (const cat of toc.categories ?? []) walk(cat.sections ?? [], [cat.slug]);
  return { filed, unfiled: (toc.articles ?? []).map((a) => a.file) };
}

/**
 * Synthesize a reconcile plan from the CONFIRMED map alone — no Zendesk call.
 * A mapped node is `linked`; an unmapped one is `create`. This powers the
 * no-token dry run (preview what the sync would do from your saved matches).
 * The LIVE sync re-reconciles against Zendesk instead, so its confirm-guard can
 * still catch a name-match that was never confirmed (which would duplicate).
 */
export function planFromMap(toc: Toc, map: ZendeskMap): ReconcilePlan {
  const summary = { linked: 0, matched: 0, ambiguous: 0, create: 0, stale: 0 };
  const sectionNode = (sec: TocSection, trail: string[]): ReconcileNode => {
    const path = [...trail, sec.slug].join("/");
    const id = map.sections[path];
    const status: ReconcileNode["status"] = id !== undefined ? "linked" : "create";
    summary[status]++;
    return {
      kind: "section", faroKey: path, name: sec.name, status, zendeskId: id,
      children: (sec.subsections ?? []).map((s) => sectionNode(s, [...trail, sec.slug])),
    };
  };
  const nodes = (toc.categories ?? []).map((cat): ReconcileNode => {
    const id = map.categories[cat.slug];
    const status: ReconcileNode["status"] = id !== undefined ? "linked" : "create";
    summary[status]++;
    return {
      kind: "category", faroKey: cat.slug, name: cat.name, status, zendeskId: id,
      children: (cat.sections ?? []).map((s) => sectionNode(s, [cat.slug])),
    };
  });
  return { nodes, orphans: { categories: [], sections: [] }, summary };
}

// ── Deletions (pure) ─────────────────────────────────────────────────────────

/**
 * Deleting is PERMANENT in Zendesk and there is no undo Faro can drive, so the
 * bar for inferring "this was deleted" is high.
 *
 * The signal is: **in the id-map, but absent from the TOC entirely**. Faro's
 * delete removes the file AND its TOC entry together (see /api/article/delete),
 * so a missing entry is a deliberate delete.
 *
 * What is deliberately NOT a delete signal:
 *  • an article that failed to COMPILE — it's still in the TOC. Keying off the
 *    compiled set would destroy live articles over a transient template error.
 *  • an UNFILED article (still in toc.articles) — it has a TOC entry, so it
 *    wasn't deleted; it just has no section. It stops publishing, nothing more.
 *  • anything not in the map — Faro never created it, so it's someone else's
 *    content in that help centre and is never touched.
 */
export function planDeletions(
  map: ZendeskMap,
  tocFiles: Set<string>
): { file: string; id: number }[] {
  return Object.entries(map.articles)
    .filter(([file]) => !tocFiles.has(file))
    .map(([file, ref]) => ({ file, id: ref.id }));
}

/** Hard ceiling on one run's deletions before an explicit override is required. */
export const MASS_DELETE_ABSOLUTE = 10;
/** …or this share of everything Faro has mapped, whichever is smaller. */
export const MASS_DELETE_FRACTION = 0.25;

/**
 * Refuse a suspiciously large delete sweep.
 *
 * The scenario this exists for: the TOC fails to load, or loads empty, and every
 * mapped article suddenly looks "deleted" — wiping a customer's help centre in
 * one run. A bug must not be indistinguishable from an instruction.
 */
export function checkDeletionSafety(
  deletions: { file: string; id: number }[],
  map: ZendeskMap,
  tocFiles: Set<string>
): { safe: boolean; reason?: string } {
  if (deletions.length === 0) return { safe: true };
  const mapped = Object.keys(map.articles).length;
  // An empty TOC alongside mapped articles is a read failure, not a mass delete.
  if (tocFiles.size === 0 && mapped > 0) {
    return { safe: false, reason: "The TOC has no articles at all — refusing to treat that as deleting everything." };
  }
  const cap = Math.min(MASS_DELETE_ABSOLUTE, Math.max(1, Math.ceil(mapped * MASS_DELETE_FRACTION)));
  if (deletions.length > cap) {
    return {
      safe: false,
      reason: `${deletions.length} articles would be permanently deleted (over the ${cap} safe limit for ${mapped} mapped). Confirm explicitly if that's intended.`,
    };
  }
  return { safe: true };
}

// ── Planner (pure) ───────────────────────────────────────────────────────────

export type SyncAction = "create" | "update" | "skip";
export interface SyncOp {
  kind: "category" | "section" | "article";
  key: string;
  name: string;
  action: SyncAction;
  zendeskId?: number;
  parentKey?: string;
  reason?: string;
}
export interface SyncPlan {
  /** False when anything blocks a clean run (unconfirmed matches or blocked articles). */
  ready: boolean;
  /** Structural nodes still needing the review screen (matched/ambiguous/stale). */
  unconfirmed: { key: string; name: string; status: string }[];
  ops: SyncOp[];
  /** Articles that cannot sync (no Zendesk home). */
  blocked: { file: string; reason: string }[];
  /** Articles that will be PERMANENTLY deleted from Zendesk — named in full, so
   *  the destructive list is reviewable before anything runs. */
  deletions: { file: string; id: number }[];
  /** Set when the mass-deletion guard tripped; deletions won't run without an
   *  explicit override. */
  deletionsBlocked?: string;
  summary: {
    categoriesCreate: number;
    sectionsCreate: number;
    articlesCreate: number;
    articlesUpdate: number;
    articlesSkip: number;
    articlesDelete: number;
    blocked: number;
  };
}

/** Nodes that must be resolved via the review screen before a sync is safe. */
function collectUnconfirmed(nodes: ReconcileNode[]): { key: string; name: string; status: string }[] {
  const out: { key: string; name: string; status: string }[] = [];
  const walk = (n: ReconcileNode) => {
    if (n.status === "matched" || n.status === "ambiguous" || n.status === "stale") {
      out.push({ key: n.faroKey, name: n.name, status: n.status });
    }
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

export function buildSyncPlan(
  plan: ReconcilePlan,
  map: ZendeskMap,
  articles: PlannedArticle[],
  unfiled: string[],
  /** Every file the TOC still knows about (filed + unfiled). Anything mapped but
   *  absent from this set was deleted in Faro. Pass the TOC's own set — NOT the
   *  successfully-compiled one, or a compile error reads as a delete. */
  tocFiles?: Set<string>
): SyncPlan {
  const unconfirmed = collectUnconfirmed(plan.nodes);
  const ops: SyncOp[] = [];
  const summary = {
    categoriesCreate: 0, sectionsCreate: 0,
    articlesCreate: 0, articlesUpdate: 0, articlesSkip: 0, articlesDelete: 0, blocked: 0,
  };

  // Structure: linked ⇒ exists (skip); create ⇒ create. (matched/ambiguous/stale
  // are surfaced via `unconfirmed`, not as ops.)
  const walkNode = (n: ReconcileNode, parentKey?: string) => {
    if (n.status === "create") {
      ops.push({ kind: n.kind, key: n.faroKey, name: n.name, action: "create", parentKey });
      if (n.kind === "category") summary.categoriesCreate++;
      else summary.sectionsCreate++;
    } else if (n.status === "linked") {
      ops.push({ kind: n.kind, key: n.faroKey, name: n.name, action: "skip", zendeskId: n.zendeskId, parentKey, reason: "exists" });
    }
    n.children.forEach((c) => walkNode(c, n.faroKey));
  };
  plan.nodes.forEach((n) => walkNode(n));

  // Which section paths will exist after the sync (linked or to-be-created)?
  const syncableSections = new Set<string>();
  const markSyncable = (n: ReconcileNode) => {
    if (n.kind === "section" && (n.status === "linked" || n.status === "create")) syncableSections.add(n.faroKey);
    n.children.forEach(markSyncable);
  };
  plan.nodes.forEach(markSyncable);

  const blocked: { file: string; reason: string }[] = [];
  for (const f of unfiled) blocked.push({ file: f, reason: "not filed under any section" });

  for (const a of articles) {
    if (!a.sectionPath || !syncableSections.has(a.sectionPath)) {
      blocked.push({ file: a.file, reason: "its section isn't being synced" });
      continue;
    }
    const existing = map.articles[a.file];
    if (!existing) {
      ops.push({ kind: "article", key: a.file, name: a.title, action: "create", parentKey: a.sectionPath, reason: "new" });
      summary.articlesCreate++;
    } else if (existing.hash !== a.hash) {
      ops.push({ kind: "article", key: a.file, name: a.title, action: "update", zendeskId: existing.id, parentKey: a.sectionPath, reason: "changed" });
      summary.articlesUpdate++;
    } else {
      ops.push({ kind: "article", key: a.file, name: a.title, action: "skip", zendeskId: existing.id, parentKey: a.sectionPath, reason: "unchanged" });
      summary.articlesSkip++;
    }
  }

  // Deletions: mapped articles the TOC no longer knows about. Only computed when
  // the caller supplies the TOC set — no set means "don't infer deletes at all",
  // which is the safe default for any caller that hasn't thought about it.
  const deletions = tocFiles ? planDeletions(map, tocFiles) : [];
  const safety = tocFiles ? checkDeletionSafety(deletions, map, tocFiles) : { safe: true as const };
  summary.articlesDelete = deletions.length;
  summary.blocked = blocked.length;

  // A tripped mass-delete guard blocks the whole run: the sync isn't "ready"
  // while it would destroy more than the safe limit without explicit consent.
  const ready = unconfirmed.length === 0 && safety.safe;
  return {
    ready, unconfirmed, ops, blocked, deletions,
    ...(safety.safe ? {} : { deletionsBlocked: safety.reason }),
    summary,
  };
}

// ── Executor ─────────────────────────────────────────────────────────────────

/** The write surface the sync needs. Real impl wraps lib/zendesk.ts; tests mock it. */
export interface ZendeskWriter {
  createCategory(name: string, description: string): Promise<number>;
  createSection(name: string, categoryId: number, parentSectionId: number | null): Promise<number>;
  createArticle(sectionId: number, a: { title: string; body: string }): Promise<{ id: number; url: string }>;
  /** Update body/title AND reparent to sectionId (moves a re-filed article). */
  updateArticle(id: number, sectionId: number, a: { title: string; body: string }): Promise<{ id: number; url: string }>;
  uploadAttachment(fileName: string, bytes: Buffer, contentType: string): Promise<{ contentUrl: string }>;
  /** PERMANENTLY delete an article. No undo — only ever called for articles the
   *  map owns and that the TOC no longer knows about. */
  deleteArticle(id: number): Promise<void>;
}

export interface SyncDeps {
  writer: ZendeskWriter;
  /** Read an asset's bytes, given its content-relative path. */
  loadBytes(contentPath: string): Promise<Buffer>;
  /** Persist the map. Called after EVERY id write — that's the idempotency. */
  persist(map: ZendeskMap): Promise<void>;
  /** rewriteAssetUrls injected (already tested in site-bundle). */
  rewriteAssets(body: string, toUrl: (contentPath: string) => string): { html: string; assets: string[] };
}

export interface SyncReport {
  categoriesCreated: number;
  sectionsCreated: number;
  articlesCreated: number;
  articlesUpdated: number;
  articlesSkipped: number;
  /** Permanently deleted from Zendesk (deleted in Faro). */
  articlesDeleted: number;
  imagesUploaded: number;
  /** Per-item failures — the sync continues past them rather than aborting. */
  failures: { key: string; error: string }[];
  /** Articles carrying internal cross-links, not yet rewritten to Zendesk URLs
   *  (a follow-up two-pass). Reported so a dead link isn't a silent surprise. */
  internalLinks: { file: string; count: number }[];
}

const basename = (p: string) => p.split("/").pop() || p;
function mimeOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "svg" ? "image/svg+xml"
    : ext === "png" ? "image/png"
    : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "gif" ? "image/gif"
    : ext === "webp" ? "image/webp"
    : "application/octet-stream";
}
/** Count relative (internal) hrefs — not external/rooted/anchor/mailto. */
function countInternalLinks(html: string): number {
  let n = 0;
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(m[1])) n++;
  }
  return n;
}

export async function executeSync(args: {
  plan: ReconcilePlan;
  map: ZendeskMap;
  articles: SyncArticle[];
  deps: SyncDeps;
  /** Articles to permanently delete — already vetted by planDeletions +
   *  checkDeletionSafety. Omit to delete nothing. */
  deletions?: { file: string; id: number }[];
  /** Required to exceed the mass-deletion cap. Re-checked here as defence in
   *  depth: permanent deletion shouldn't rest on one caller getting it right. */
  allowMassDelete?: boolean;
}): Promise<SyncReport> {
  const { plan, map, articles, deps, deletions = [], allowMassDelete = false } = args;
  const report: SyncReport = {
    categoriesCreated: 0, sectionsCreated: 0,
    articlesCreated: 0, articlesUpdated: 0, articlesSkipped: 0, articlesDeleted: 0,
    imagesUploaded: 0, failures: [], internalLinks: [],
  };

  // Refuse to run with unconfirmed/broken structure — creating an unconfirmed
  // "matched" node would duplicate a category that already exists in Zendesk.
  const unconfirmed = collectUnconfirmed(plan.nodes);
  if (unconfirmed.length) {
    throw new Error(
      `Confirm ${unconfirmed.length} structural match${unconfirmed.length !== 1 ? "es" : ""} before syncing: ` +
      unconfirmed.map((u) => `${u.name} (${u.status})`).join(", ")
    );
  }

  // 1. Categories (create → id, written back immediately).
  const catId = new Map<string, number>();
  for (const node of plan.nodes) {
    if (node.status === "linked" && node.zendeskId) { catId.set(node.faroKey, node.zendeskId); continue; }
    if (node.status !== "create") continue;
    try {
      const id = await deps.writer.createCategory(node.name, "");
      map.categories[node.faroKey] = id;
      await deps.persist(map);
      catId.set(node.faroKey, id);
      report.categoriesCreated++;
    } catch (e) {
      report.failures.push({ key: node.faroKey, error: msg(e) });
    }
  }

  // 2. Sections (parent-first; each created id persisted before its children).
  const sectionId = new Map<string, number>();
  const walkSections = async (nodes: ReconcileNode[], categoryKey: string, parentSectionId: number | null) => {
    for (const node of nodes) {
      if (node.kind !== "section") continue;
      let id: number | undefined;
      if (node.status === "linked" && node.zendeskId) {
        id = node.zendeskId;
      } else if (node.status === "create") {
        const parentCat = catId.get(categoryKey);
        if (parentCat === undefined) { report.failures.push({ key: node.faroKey, error: "parent category not synced" }); continue; }
        try {
          id = await deps.writer.createSection(node.name, parentCat, parentSectionId);
          map.sections[node.faroKey] = id;
          await deps.persist(map);
          sectionId.set(node.faroKey, id);
          report.sectionsCreated++;
        } catch (e) {
          report.failures.push({ key: node.faroKey, error: msg(e) });
          continue;
        }
      }
      if (id !== undefined) {
        sectionId.set(node.faroKey, id);
        await walkSections(node.children, categoryKey, id); // subsections nest under this section
      }
    }
  };
  for (const cat of plan.nodes) await walkSections(cat.children, cat.faroKey, null);

  // 3. Articles — publish live, images as attachments, unchanged skipped.
  for (const a of articles) {
    try {
      const secId = sectionId.get(a.sectionPath);
      if (secId === undefined) { report.failures.push({ key: a.file, error: "section not synced" }); continue; }

      const existing = map.articles[a.file];
      if (existing && existing.hash === a.hash) { report.articlesSkipped++; continue; }

      // Upload each referenced image, then point the body at its content_url.
      const urls = new Map<string, string>();
      for (const asset of [...new Set(a.assets)]) {
        const bytes = await deps.loadBytes(`content/${asset}`);
        const { contentUrl } = await deps.writer.uploadAttachment(basename(asset), bytes, mimeOf(asset));
        urls.set(asset, contentUrl);
        report.imagesUploaded++;
      }
      const { html: body } = deps.rewriteAssets(a.body, (p) => urls.get(p) ?? `/api/content?path=${encodeURIComponent(p)}&raw=1`);

      const links = countInternalLinks(body);
      if (links) report.internalLinks.push({ file: a.file, count: links });

      const result = existing
        ? await deps.writer.updateArticle(existing.id, secId, { title: a.title, body })
        : await deps.writer.createArticle(secId, { title: a.title, body });
      if (existing) report.articlesUpdated++; else report.articlesCreated++;

      map.articles[a.file] = { id: result.id, hash: a.hash };
      await deps.persist(map);
    } catch (e) {
      report.failures.push({ key: a.file, error: msg(e) });
    }
  }

  // 4. Deletions — LAST, and permanent. Running after the creates/updates means a
  //    failure earlier never leaves content deleted but not republished.
  if (deletions.length) {
    const cap = Math.min(MASS_DELETE_ABSOLUTE, Math.max(1, Math.ceil(Object.keys(map.articles).length * MASS_DELETE_FRACTION)));
    if (deletions.length > cap && !allowMassDelete) {
      // Defence in depth: the route checks this too, but permanent deletion
      // shouldn't depend on a single caller having got it right.
      report.failures.push({
        key: "(deletions)",
        error: `Refused to delete ${deletions.length} articles without explicit confirmation (safe limit ${cap}).`,
      });
      return report;
    }
    for (const d of deletions) {
      try {
        await deps.writer.deleteArticle(d.id);
        // Drop it from the map only after Zendesk confirms, so a failure leaves
        // the mapping intact and the next run retries rather than orphaning it.
        delete map.articles[d.file];
        await deps.persist(map);
        report.articlesDeleted++;
      } catch (e) {
        report.failures.push({ key: d.file, error: msg(e) });
      }
    }
  }

  return report;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
