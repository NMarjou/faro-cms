import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { deleteFile } from "@/lib/storage";
import { mutateJsonFile } from "@/lib/sidecar";
import { findTocArticle, loadToc, getRequestUser, unauthorized, forbidden } from "@/lib/server-auth";
import { canEditArticle } from "@/lib/permissions";
import { removeArticleFromToc } from "@/lib/toc-walk";
import type { Toc } from "@/lib/types";

/**
 * POST /api/article/delete   Body: { path }
 *
 * Delete an article: its TOC entry AND its file. Authorized for tech writers
 * (any article) or the article's owner — mirroring /api/article/meta, since this
 * mutates the otherwise tech-writer-only toc.json.
 *
 * ORDER MATTERS. The entry goes first, then the file:
 *   • entry removed, file delete fails  → an orphan FILE. Invisible (nothing
 *     references it), harmless, recoverable.
 *   • file removed, entry remains       → a stale TOC ENTRY. compile can't read
 *     it, publish skips it silently, and the Zendesk sync can't tell "deleted"
 *     from "unreadable" — so it would stay live in the customer help centre
 *     forever, unreported.
 * The second is the damaging failure, so we never risk it. The two writes aren't
 * one transaction (they're separate commits), so the order IS the guarantee.
 *
 * Removing the entry is also the signal the Zendesk sync reads: "in the id-map
 * but absent from the TOC" ⇒ deleted in Faro ⇒ delete from Zendesk.
 */
const TOC_PATH = "content/toc.json";
const ARTICLE_EXT = /\.(mdx|html?)$/i;

export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!user) return unauthorized();

  try {
    const { path } = (await request.json().catch(() => ({}))) as { path?: string };
    const rel = (path || "").replace(/^content\//, "");
    // Reject anything that isn't an article: no traversal, no snippets/images.
    if (!rel || rel.includes("..") || !ARTICLE_EXT.test(rel) || rel.startsWith("snippets/") || rel.startsWith("images/")) {
      return NextResponse.json({ error: "Not an article path" }, { status: 400 });
    }

    const toc = await loadToc();
    if (!toc) return NextResponse.json({ error: "Couldn't read the TOC" }, { status: 500 });

    const entry = findTocArticle(toc, rel);
    if (!entry) return NextResponse.json({ error: "Article is not in the TOC" }, { status: 404 });
    if (!canEditArticle(user.role, entry, user.email)) {
      return forbidden("You can only delete articles you own");
    }

    // 1. Drop the entry (re-reads + retries on conflict inside mutateJsonFile).
    await mutateJsonFile<Toc>(
      TOC_PATH,
      (current) => removeArticleFromToc(current ?? toc, rel).toc,
      `Delete article: ${entry.title}`
    );

    // 2. Drop the file. If this fails the article is already gone from Faro's
    //    view and from the next sync's scope; the leftover file is dead weight,
    //    so report it rather than resurrecting the entry.
    let fileDeleted = true;
    try {
      await deleteFile(`content/${rel}`, `Delete article: ${entry.title}`);
    } catch {
      fileDeleted = false;
    }

    return NextResponse.json({ success: true, file: rel, fileDeleted });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to delete article";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
