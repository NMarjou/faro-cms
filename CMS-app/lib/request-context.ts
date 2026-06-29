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
 * Identity travels in `x-cms-user`; the active project travels in `x-cms-project`
 * (both attached by the client fetch interceptor in CurrentUserProvider).
 */

import { AsyncLocalStorage } from "async_hooks";
import { DEFAULT_PROJECT_SLUG } from "./content-paths";

export const PROJECT_HEADER = "x-cms-project";

interface RequestStore {
  project: string;
}

const als = new AsyncLocalStorage<RequestStore>();

/**
 * Bind the request's project to the current async context. Reads the
 * `x-cms-project` header; falls back to the env/default project when absent.
 * Call once at the top of a content route handler.
 */
export function setRequestProject(request: Request): void {
  const project =
    request.headers.get(PROJECT_HEADER) ||
    process.env.CMS_DEFAULT_PROJECT ||
    DEFAULT_PROJECT_SLUG;
  als.enterWith({ project });
}

/** The project for the current request, or the env/default when none is set. */
export function getCurrentProject(): string {
  return (
    als.getStore()?.project ||
    process.env.CMS_DEFAULT_PROJECT ||
    DEFAULT_PROJECT_SLUG
  );
}

/**
 * Run `fn` with the project temporarily bound to `slug` — for operations that
 * must target a project other than the request's own (e.g. seeding a new
 * project's toc.json from the create endpoint). Restores the prior context
 * after `fn` resolves.
 */
export function runWithProject<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  return als.run({ project: slug }, fn);
}
