// ── Role capabilities ──
//
// Central place to answer "is this user allowed to do X?". Lets the UI (and any
// future server-side enforcement) branch on intent instead of negating a single
// role. With three roles — tech-writer, author, contributor — the old
// `!isContributor` shorthand for "tech writer" no longer holds, so route every
// check through these helpers.
//
// NOTE: auth isn't wired yet, so these gate the UI only. They take the
// client-resolved role/email; they are not a security boundary on their own.

import type { UserRole } from "./types";

/** Owns the platform: structure, snippets, variables, publishing, settings, etc. */
export function isTechWriter(role: UserRole | null): boolean {
  return role === "tech-writer";
}

/** Can create brand-new articles (and, for authors, become their owner). */
export function canCreateArticles(role: UserRole | null): boolean {
  return role === "tech-writer" || role === "author";
}

/**
 * Can use the Images section — upload and organize images. Authors need this
 * to add images to the articles they write. Contributors cannot (they review,
 * they don't author content). Images are a shared resource, not owned.
 */
export function canManageImages(role: UserRole | null): boolean {
  return role === "tech-writer" || role === "author";
}

/**
 * Can delete a specific image. Tech writers can delete any image; authors can
 * delete only images they uploaded (own). `image.owner` is the uploader email.
 */
export function canDeleteImage(
  role: UserRole | null,
  image: { owner?: string } | null | undefined,
  email: string | null | undefined
): boolean {
  if (role === "tech-writer") return true;
  if (role === "author") {
    return (
      !!image?.owner &&
      !!email &&
      image.owner.toLowerCase() === email.toLowerCase()
    );
  }
  return false;
}

/** Can publish content (open the publish PR). Authors must instead submit for sign-off. */
export function canPublish(role: UserRole | null): boolean {
  return role === "tech-writer";
}

/** True when `email` is the recorded owner of `article`. Case-insensitive. */
export function ownsArticle(
  article: { author?: string } | null | undefined,
  email: string | null | undefined
): boolean {
  return (
    !!article?.author &&
    !!email &&
    article.author.toLowerCase() === email.toLowerCase()
  );
}

/**
 * Can edit an article's body/metadata.
 * - tech-writer: any article
 * - author: only articles they own
 * - contributor: never (view + comment/suggest only)
 */
export function canEditArticle(
  role: UserRole | null,
  article: { author?: string } | null | undefined,
  email: string | null | undefined
): boolean {
  if (role === "tech-writer") return true;
  if (role === "author") return ownsArticle(article, email);
  return false;
}

/** An author can submit one of their own articles for tech-writer sign-off. */
export function canSubmitForApproval(
  role: UserRole | null,
  article: { author?: string } | null | undefined,
  email: string | null | undefined
): boolean {
  return role === "author" && ownsArticle(article, email);
}
