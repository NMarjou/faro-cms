/**
 * Server-side authorization layer.
 *
 * The role helpers in `lib/permissions.ts` gate the UI; this module re-checks
 * the same rules on the server so the API stops trusting the client.
 *
 * ── Honest caveat ────────────────────────────────────────────────────────────
 * There is no real authentication yet. Identity arrives in the `x-cms-user`
 * request header, sourced from the browser's localStorage by the global fetch
 * interceptor in `CurrentUserProvider`. That header is trivially spoofable
 * (any curl can set it), so this is defense-in-depth + centralization, NOT a
 * true security boundary. When NextAuth lands, `getRequestUser()` is the single
 * seam that changes — from "read header" to "read session"; every route guard
 * below keeps working unchanged.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, isAuthConfigured } from "./auth-options";
import { getFile } from "./storage";
import { flattenTocArticles } from "./toc-walk";
import {
  DEFAULT_USERS,
  type Toc,
  type TocArticle,
  type User,
  type UsersData,
} from "./types";
import {
  isTechWriter,
  canManageImages,
  canCreateArticles,
  canEditArticle,
} from "./permissions";

/** Header the client fetch interceptor sets to the active user's email. */
export const IDENTITY_HEADER = "x-cms-user";

const USERS_PATH = "content/users.json";
const TOC_PATH = "content/toc.json";

/**
 * Load the user list from content. The single source of truth — replaces the
 * `loadUsers()`/`loadExistingUsers()` copies that used to live in each route.
 * Falls back to the seed list if the file is missing or unreadable (mirrors
 * the behaviour of `/api/users`).
 */
export async function loadUsers(): Promise<User[]> {
  try {
    const file = await getFile(USERS_PATH);
    const data = JSON.parse(file.content) as UsersData;
    return data.users || DEFAULT_USERS;
  } catch {
    return DEFAULT_USERS;
  }
}

/**
 * Resolve the calling user from the request, then match their email
 * (case-insensitively) against the user list. Returns null when there's no
 * identity or the email isn't a known user — callers treat null as "deny" for
 * any privileged action.
 *
 * THIS IS THE AUTH SEAM. Two modes:
 *   - OAuth configured  → identity comes from the authenticated NextAuth
 *     session cookie. The `x-cms-user` header is ignored, so it can't be
 *     spoofed; this is the real security boundary.
 *   - OAuth not configured (dev) → identity comes from the `x-cms-user`
 *     header set by the client fetch interceptor. Spoofable, dev-only.
 */
export async function getRequestUser(
  request: Request
): Promise<User | null> {
  const email = await resolveIdentityEmail(request);
  if (!email) return null;
  const users = await loadUsers();
  return (
    users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null
  );
}

/** The email of the calling user, or null. Session when OAuth is on, header otherwise. */
async function resolveIdentityEmail(request: Request): Promise<string | null> {
  if (isAuthConfigured()) {
    const session = await getServerSession(authOptions);
    return session?.user?.email ?? null;
  }
  return request.headers.get(IDENTITY_HEADER);
}

/**
 * Find a TOC article by file — at ANY depth, plus the standalone bucket.
 *
 * This used to hand-roll its own walk that recursed exactly ONE level into
 * subsections, so an article nested deeper returned null. Since ownership is
 * read off the returned entry, that silently locked AUTHORS out of their own
 * deeply-nested articles (`canEditArticle(role, null, …)` → false), while tech
 * writers sailed through — so it never showed up in testing. Use the one shared
 * walker instead: lib/toc-walk.ts is the single source of truth for "what are
 * all the articles?".
 */
export function findTocArticle(toc: Toc, file: string): TocArticle | null {
  return flattenTocArticles(toc).find((a) => a.file === file) ?? null;
}

/** Load + parse the TOC; null on any failure (callers default-deny). */
export async function loadToc(): Promise<Toc | null> {
  try {
    const file = await getFile(TOC_PATH);
    return JSON.parse(file.content) as Toc;
  } catch {
    return null;
  }
}

// ── Guard responses ────────────────────────────────────────────────────────

/** 401 — no identity at all (missing/unknown `x-cms-user`). */
export function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Not signed in" },
    { status: 401 }
  );
}

/** 403 — known user, but their role doesn't permit the action. */
export function forbidden(message = "You don't have permission to do that"): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

// ── /api/content path classification ─────────────────────────────────────────

/** Platform config files only a tech writer may write. */
const TECH_WRITER_FILES = new Set([
  "toc.json",
  "users.json",
  "variables.json",
  "glossary.json",
  "conditions.json",
  "styles.json",
  "editor-styles.css",
  "dictionary.json",
]);

/**
 * Authorize a write to `/api/content` by inspecting the target `path`. The
 * generic content endpoint can target many content types, each with its own
 * rule:
 *   - platform config + snippets → tech-writer
 *   - images/**                  → canManageImages (tech-writer or author)
 *   - article files              → canEditArticle (owner-aware) if it exists
 *                                  in the TOC, else canCreateArticles (new file)
 *
 * `path` is the content-relative path the route receives (no "content/" prefix),
 * e.g. "help/passport/overview.mdx", "toc.json", "images/foo.png".
 */
export async function canWriteContentPath(
  path: string,
  user: User | null
): Promise<boolean> {
  if (!user) return false;
  const role = user.role;

  // Normalize: tolerate a leading "content/" if a caller ever includes it.
  const p = path.replace(/^content\//, "");

  if (TECH_WRITER_FILES.has(p) || p.startsWith("snippets/")) {
    return isTechWriter(role);
  }
  if (p.startsWith("images/")) {
    return canManageImages(role);
  }

  // Otherwise treat it as an article body. Resolve ownership from the TOC.
  const toc = await loadToc();
  const article = toc ? findTocArticle(toc, p) : null;
  if (article) {
    return canEditArticle(role, article, user.email);
  }
  // Not in the TOC → a brand-new article file being created.
  return canCreateArticles(role);
}
