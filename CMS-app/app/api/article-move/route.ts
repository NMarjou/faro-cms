import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile, deleteFile } from "@/lib/storage";
import type { Toc, TocSection, TocArticle } from "@/lib/types";

/**
 * Article Move / Rename API
 *
 * When an article is renamed (slug change) or moved (folder change),
 * this endpoint:
 *   1. Moves the file (read old → write new → delete old)
 *   2. Updates the TOC entry (file, slug, title)
 *   3. Rewrites all links in other articles that pointed to the old path
 */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collect every article reference from the TOC */
function collectAllArticles(toc: Toc): TocArticle[] {
  const articles: TocArticle[] = [];
  for (const cat of toc.categories) {
    const walk = (sections: TocSection[]) => {
      for (const sec of sections) {
        articles.push(...sec.articles);
        if (sec.subsections) walk(sec.subsections);
      }
    };
    walk(cat.sections);
  }
  if (toc.articles) articles.push(...toc.articles);
  return articles;
}

/** Find and mutate the article entry in the TOC */
function updateArticleInToc(
  toc: Toc,
  oldFile: string,
  newFile: string,
  newSlug: string,
  newTitle: string
): boolean {
  for (const cat of toc.categories) {
    const walkSections = (sections: TocSection[]): boolean => {
      for (const sec of sections) {
        const idx = sec.articles.findIndex((a) => a.file === oldFile);
        if (idx !== -1) {
          sec.articles[idx] = {
            ...sec.articles[idx],
            file: newFile,
            slug: newSlug,
            title: newTitle,
          };
          return true;
        }
        if (sec.subsections && walkSections(sec.subsections)) return true;
      }
      return false;
    };
    if (walkSections(cat.sections)) return true;
  }
  if (toc.articles) {
    const idx = toc.articles.findIndex((a) => a.file === oldFile);
    if (idx !== -1) {
      toc.articles[idx] = { ...toc.articles[idx], file: newFile, slug: newSlug, title: newTitle };
      return true;
    }
  }
  return false;
}

/** Rewrite links in a single article's content */
function rewriteLinks(content: string, oldFile: string, newFile: string): string {
  let updated = content;

  // Build all possible old href variants that might reference the old file
  // e.g. "admin/setup.html", "setup.html", "setup", "../admin/setup.html"
  const oldVariants = new Set<string>();
  oldVariants.add(oldFile);
  oldVariants.add(oldFile.replace(/\.html?$/, ""));
  const oldFilename = oldFile.split("/").pop() || "";
  oldVariants.add(oldFilename);
  oldVariants.add(oldFilename.replace(/\.html?$/, ""));

  for (const oldHref of oldVariants) {
    if (!oldHref) continue;

    // HTML <a href="...">
    const htmlRegex = new RegExp(
      `(<a\\s+[^>]*href=")${escapeRegex(oldHref)}((?:#[^"]*)?[""][^>]*>)`,
      "gi"
    );
    updated = updated.replace(htmlRegex, `$1${newFile}$2`);

    // Markdown [text](href)
    const mdRegex = new RegExp(
      `(\\[[^\\]]+\\]\\()${escapeRegex(oldHref)}((?:#[^)]*)?\\))`,
      "g"
    );
    updated = updated.replace(mdRegex, `$1${newFile}$2`);
  }

  return updated;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { oldFile, newSlug, newTitle, newFolder } = body as {
      oldFile: string;    // current file path relative to content/ (e.g. "admin/setup.html")
      newSlug: string;    // new slug
      newTitle: string;   // new title
      newFolder?: string; // optional new folder (if moving)
    };

    if (!oldFile || !newSlug || !newTitle) {
      return NextResponse.json({ error: "oldFile, newSlug, and newTitle are required" }, { status: 400 });
    }

    // Determine new file path
    const ext = oldFile.match(/\.[^.]+$/)?.[0] || ".html";
    const oldFolder = oldFile.includes("/") ? oldFile.substring(0, oldFile.lastIndexOf("/")) : "";
    const folder = newFolder !== undefined ? newFolder : oldFolder;
    const newFile = folder ? `${folder}/${newSlug}${ext}` : `${newSlug}${ext}`;

    const fileChanged = newFile !== oldFile;

    // 1. Load TOC
    const tocRes = await getFile("content/toc.json");
    const toc: Toc = JSON.parse(tocRes.content);

    // 2. If file path changed, move the file
    if (fileChanged) {
      // Read old file
      const old = await getFile(`content/${oldFile}`);

      // Write to new location
      await putFile(
        `content/${newFile}`,
        old.content,
        `Move article: ${oldFile} → ${newFile}`
      );

      // Delete old file
      await deleteFile(
        `content/${oldFile}`,
        `Remove old article path: ${oldFile}`
      );
    }

    // 3. Update TOC entry
    updateArticleInToc(toc, oldFile, newFile, newSlug, newTitle);
    await putFile("content/toc.json", JSON.stringify(toc, null, 2), `Update TOC: rename ${oldFile} → ${newFile}`);

    // 4. Cascade: rewrite links in all other articles
    let linksRewritten = 0;
    if (fileChanged) {
      const allArticles = collectAllArticles(toc);
      for (const article of allArticles) {
        if (article.file === newFile) continue; // skip the moved article itself

        let content: string;
        try {
          const file = await getFile(`content/${article.file}`);
          content = file.content;
        } catch {
          continue;
        }

        const rewritten = rewriteLinks(content, oldFile, newFile);
        if (rewritten !== content) {
          await putFile(
            `content/${article.file}`,
            rewritten,
            `Update links: ${oldFile} → ${newFile}`
          );
          linksRewritten++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      oldFile,
      newFile,
      fileChanged,
      linksRewritten,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Article move failed" },
      { status: 500 }
    );
  }
}
