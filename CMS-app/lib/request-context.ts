/**
 * Per-request project context.
 *
 * The path layer (lib/content-paths.ts → lib/github.ts / lib/local-fs.ts) needs
 * to know which project a request targets, synchronously, deep in the call
 * stack. We carry it in an AsyncLocalStorage store set at the top of each
 * content route via `setRequestProject(request)` — mirroring how routes already
 * call `getRequestUser(request)`. `enterWith` makes the value visible for the
 * rest of the request's async continuation without wrapping the handler.
 *
 * Phase 3: the store also carries the project's resolved **working** (draft) and
 * **base** (publish) branches, from its `publishTarget` in the manifest, falling
 * back to the env globals. `lib/github.ts` reads them so branch selection is
 * per-project without threading branch names through every caller. Resolving
 * needs an async manifest read, so `setRequestProject`/`runWithProject` are async.
 *
 * Identity travels in `x-cms-user`; the active project travels in `x-cms-project`
 * (both attached by the client fetch interceptor in CurrentUserProvider).
 */

import { AsyncLocalStorage } from "async_hooks";
import { DEFAULT_PROJECT_SLUG } from "./content-paths";

export const PROJECT_HEADER = "x-cms-project";

interface RequestStore {
  project: string;
  working: string;
  base: string;
}

const als = new AsyncLocalStorage<RequestStore>();

// Env fallbacks mirror lib/github.ts: base = GITHUB_DEFAULT_BRANCH ("main"),
// working = CMS_WORKING_BRANCH (falling back to base when unset).
function envBase(): string {
  return process.env.GITHUB_DEFAULT_BRANCH || "main";
}
function envWorking(): string {
  return process.env.CMS_WORKING_BRANCH || envBase();
}

/**
 * Resolve a project's working/base branches from its manifest `publishTarget`,
 * env fallback otherwise. Lazy imports avoid a load-order cycle (projects →
 * storage → content-paths → request-context). The manifest read is memoized
 * (short TTL) since it runs on every content request; `/api/projects` writes
 * invalidate `PROJECTS_CACHE_KEY`.
 */
export const PROJECTS_CACHE_KEY = "branches:projects-manifest";

async function resolveBranches(slug: string): Promise<{ working: string; base: string }> {
  try {
    const [{ loadProjects }, { memoize }] = await Promise.all([
      import("./projects"),
      import("./cache"),
    ]);
    const projects = await memoize(PROJECTS_CACHE_KEY, () => loadProjects(), 30_000);
    const p = projects.find((x) => x.slug === slug);
    return {
      base: p?.publishTarget?.baseBranch || envBase(),
      working: p?.publishTarget?.workingBranch || envWorking(),
    };
  } catch {
    return { base: envBase(), working: envWorking() };
  }
}

/**
 * Bind the request's project (and its resolved branches) to the current async
 * context. Reads the `x-cms-project` header; falls back to the env/default
 * project when absent. `await` at the top of a content route handler.
 *
 * IMPORTANT: `enterWith` must run SYNCHRONOUSLY (before any await), otherwise
 * the store is set on this function's continuation rather than the caller's
 * async context and `getCurrentProject()` silently reverts to the default for
 * the whole request. So we enter first with the project + env-default branches,
 * then mutate the *same* store object in place once the manifest resolves.
 */
export async function setRequestProject(request: Request): Promise<void> {
  const project =
    request.headers.get(PROJECT_HEADER) ||
    process.env.CMS_DEFAULT_PROJECT ||
    DEFAULT_PROJECT_SLUG;
  const store: RequestStore = { project, working: envWorking(), base: envBase() };
  als.enterWith(store);
  const { working, base } = await resolveBranches(project);
  store.working = working;
  store.base = base;
}

/** The project for the current request, or the env/default when none is set. */
export function getCurrentProject(): string {
  return (
    als.getStore()?.project ||
    process.env.CMS_DEFAULT_PROJECT ||
    DEFAULT_PROJECT_SLUG
  );
}

/** The current project's working (draft) branch, env fallback outside a request. */
export function getCurrentWorkingBranch(): string {
  return als.getStore()?.working || envWorking();
}

/** The current project's base (publish) branch, env fallback outside a request. */
export function getCurrentBaseBranch(): string {
  return als.getStore()?.base || envBase();
}

/**
 * Run `fn` with the project (and its resolved branches) temporarily bound to
 * `slug` — for operations that must target a project other than the request's
 * own (seeding a new project's toc.json; the webhook marking published per
 * project). Restores the prior context after `fn` resolves.
 */
export async function runWithProject<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const { working, base } = await resolveBranches(slug);
  return als.run({ project: slug, working, base }, fn);
}
