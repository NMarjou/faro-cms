/**
 * Content path rooting — the single place that knows the on-disk/repo layout.
 *
 * The app addresses all content as `content/<rel>`. Physically it now lives in:
 *   - platform files at the CMS-content root      (users.json, projects.json)
 *   - the shared asset pool under  shared/        (snippets, images, styles, …)
 *   - per-project content under    projects/<slug>/ (toc.json, articles, sidecars)
 *
 * Routes keep using `content/<rel>` unchanged; the storage backends
 * (lib/github.ts, lib/local-fs.ts) translate through here. Pure + synchronous
 * so the existing sync path mappers can call it.
 *
 * Phase 0 is single-project: `currentProjectSlug()` returns the default. That
 * function is the seam Phase 2 will make request-scoped (x-cms-project header).
 */

/** Default project slug for the migrated single-project tree. */
export const DEFAULT_PROJECT_SLUG = "accelerate";

/**
 * The project whose content `content/<rel>` paths resolve to. Phase 0: always
 * the default (env-overridable). Phase 2 replaces this with per-request
 * resolution — every caller below goes through it, so that swap is localized.
 */
export function currentProjectSlug(): string {
  return process.env.CMS_DEFAULT_PROJECT || DEFAULT_PROJECT_SLUG;
}

// ── Classification ───────────────────────────────────────────────────────────

/** Files that live at the CMS-content root, outside any project or the pool. */
const PLATFORM_FILES = new Set(["users.json", "projects.json"]);

/** Shared config files (alongside snippets/** and images/** which are dir-based). */
const SHARED_FILES = new Set([
  "variables.json",
  "glossary.json",
  "conditions.json",
  "styles.json",
  "editor-styles.css",
  "dictionary.json",
  "custom-dictionary.json",
]);

const SHARED_DIR = "shared";
const PROJECTS_DIR = "projects";

export type ContentScope = "platform" | "shared" | "project";

/** Shared asset directories (matched as the dir itself or any path under it). */
const SHARED_DIRS = ["snippets", "images"];

/** Where a content-relative path (no leading `content/`) belongs. */
export function classify(rel: string): ContentScope {
  if (PLATFORM_FILES.has(rel)) return "platform";
  // Match the bare dir ("snippets") as well as paths under it ("snippets/x").
  if (SHARED_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) return "shared";
  if (SHARED_FILES.has(rel)) return "shared";
  // toc.json, article bodies, and their .comments.json/.suggestions.json sidecars.
  return "project";
}

// ── Forward mapping: app `content/<rel>` → sub-path under CMS-content/ ──────────

/** Strip a leading `content/` (app prefix) if present. */
function stripContentPrefix(appPath: string): string {
  return appPath.startsWith("content/") ? appPath.slice("content/".length) : appPath;
}

/**
 * Sub-path under `CMS-content/` for a content-relative path. e.g.
 *   "snippets/x.mdx"        → "shared/snippets/x.mdx"
 *   "help/passport/x.mdx"   → "projects/accelerate/help/passport/x.mdx"
 *   "users.json"            → "users.json"
 */
export function contentSubpath(rel: string, slug: string = currentProjectSlug()): string {
  switch (classify(rel)) {
    case "platform":
      return rel;
    case "shared":
      return `${SHARED_DIR}/${rel}`;
    case "project":
      return `${PROJECTS_DIR}/${slug}/${rel}`;
  }
}

/** As `contentSubpath`, but accepts an app path that may carry the `content/` prefix. */
export function contentSubpathFromApp(appPath: string, slug?: string): string {
  return contentSubpath(stripContentPrefix(appPath), slug);
}

// ── Reverse mapping: sub-path under CMS-content/ → app `content/<rel>` ──────────

/**
 * Inverse of `contentSubpath`: turn a CMS-content-relative sub-path back into an
 * app `content/<rel>` path. Strips `shared/` or `projects/<slug>/`. Round-trips
 * with `contentSubpath` for every scope.
 */
export function subpathToContent(sub: string): string {
  if (sub.startsWith(`${SHARED_DIR}/`)) {
    return `content/${sub.slice(SHARED_DIR.length + 1)}`;
  }
  if (sub.startsWith(`${PROJECTS_DIR}/`)) {
    // projects/<slug>/<rel> → content/<rel>
    const afterProjects = sub.slice(PROJECTS_DIR.length + 1);
    const slash = afterProjects.indexOf("/");
    if (slash >= 0) return `content/${afterProjects.slice(slash + 1)}`;
    return `content/${afterProjects}`; // bare projects/<slug> (no file) — unlikely
  }
  return `content/${sub}`;
}
