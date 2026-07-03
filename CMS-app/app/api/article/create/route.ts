import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile, putFile } from "@/lib/storage";
import { mutateJsonFile } from "@/lib/sidecar";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { canCreateArticles } from "@/lib/permissions";
import type { Toc, TocArticle } from "@/lib/types";

/**
 * POST /api/article/create   Body: { title, slug }
 *
 * Create a standalone article: writes the body file AND inserts its TOC entry
 * in one authorized, server-side step. Authorized by `canCreateArticles`
 * (tech-writer or author), NOT by the tech-writer-only `/api/toc` gate — so an
 * author can create an article and be recorded as its owner.
 *
 * The owner (`author`) is stamped from the authenticated identity, never the
 * request body, so ownership (which gates edit rights) can't be spoofed. The
 * TOC write goes through `mutateJsonFile` (read-modify-write with retry) so a
 * concurrent create or structure edit isn't clobbered.
 *
 * This fixes the bug where an author's create flow wrote the body but its
 * client-side `PUT /api/toc` 403'd, losing the entry + owner stamp — leaving
 * the article out of the TOC and read-only in the editor.
 */
const TOC_PATH = "content/toc.json";

export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!canCreateArticles(user?.role ?? null)) {
    return forbidden("You don't have permission to create articles");
  }
  try {
    const { title, slug } = (await request.json()) as { title?: string; slug?: string };
    const cleanTitle = (title || "").trim();
    const cleanSlug = (slug || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!cleanTitle || !cleanSlug) {
      return NextResponse.json({ error: "title and slug are required" }, { status: 400 });
    }

    const file = `${cleanSlug}.html`;

    // Don't clobber an existing article body with the same slug.
    try {
      await getFile(`content/${file}`);
      return NextResponse.json(
        { error: `An article "${file}" already exists — choose a different title.` },
        { status: 409 }
      );
    } catch {
      /* not found — good, we can create it */
    }

    const today = new Date().toISOString().split("T")[0];
    const content = `<h1>${cleanTitle}</h1>\n<p>Start writing here...</p>\n`;
    await putFile(`content/${file}`, content, `Create new article: ${cleanTitle}`);

    // Insert the standalone TOC entry, stamping the creator as owner.
    await mutateJsonFile<Toc>(
      TOC_PATH,
      (cur) => {
        const toc: Toc = cur ?? { categories: [] };
        const articles = toc.articles ?? [];
        if (!articles.some((a) => a.file === file)) {
          const entry: TocArticle = {
            title: cleanTitle,
            file,
            slug: cleanSlug,
            format: "html",
            createdDate: today,
            lastModified: today,
            ...(user!.email ? { author: user!.email } : {}),
          };
          articles.push(entry);
        }
        return { ...toc, articles };
      },
      `Add ${cleanTitle} to TOC`
    );

    return NextResponse.json({ ok: true, path: file });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to create article";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
