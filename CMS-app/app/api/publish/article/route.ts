import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import {
  getFile,
  putFile,
  createBranch,
  createPR,
  defaultBranch,
  workingBranch,
} from "@/lib/github";
import { getRequestUser, findTocArticle, forbidden } from "@/lib/server-auth";
import { canPublish } from "@/lib/permissions";
import { articleOwesSignoff, upsertArticleIntoToc } from "@/lib/article-workflow";
import type { Toc } from "@/lib/types";

/**
 * POST /api/publish/article  Body: { path }
 *
 * Publish a SINGLE article as an isolated PR: a fresh branch off the default
 * branch carrying just this article's body plus its TOC entry merged onto the
 * default branch's TOC. Articles publish independently — an in-review article
 * never blocks shipping another, and each PR is reviewable on its own.
 *
 * Shared resources (snippets, variables, glossary, images, TOC structure) are
 * NOT included here — those go through the branch-wide "Publish all"
 * (/api/publish). An article that references a shared resource changed only on
 * the working branch will publish without it; publish the resource separately.
 */
export async function POST(request: NextRequest) {
  setRequestProject(request);
  const user = await getRequestUser(request);
  if (!canPublish(user?.role ?? null)) {
    return forbidden("Only tech writers can publish");
  }

  try {
    const { path } = (await request.json()) as { path?: string };
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    const base = defaultBranch();
    const head = workingBranch();
    if (head === base) {
      return NextResponse.json(
        {
          error:
            "Working branch equals the default branch — nothing to publish. Set CMS_WORKING_BRANCH to a separate branch so edits land there first.",
        },
        { status: 400 }
      );
    }

    // Source of truth for the article + its placement is the working-branch TOC.
    const workingTocFile = await getFile("content/toc.json", head);
    const workingToc = JSON.parse(workingTocFile.content) as Toc;
    const article = findTocArticle(workingToc, path);
    if (!article) {
      return NextResponse.json(
        { error: "Article not found in TOC" },
        { status: 404 }
      );
    }

    // Gate: an article still owing a sign-off can't publish.
    if (articleOwesSignoff(article)) {
      return NextResponse.json(
        {
          error: `Cannot publish — "${article.title}" awaits tech-writer sign-off.`,
        },
        { status: 409 }
      );
    }

    // Fresh isolated branch off the default branch.
    const slug = (article.slug || path.replace(/[^a-zA-Z0-9]+/g, "-")).replace(
      /(^-|-$)/g,
      ""
    );
    const branch = `publish/${slug}-${Date.now()}`;
    await createBranch(branch, base);

    // Copy the article body from the working branch onto the publish branch.
    const body = await getFile(`content/${path}`, head);
    await putFile(
      `content/${path}`,
      body.content,
      `Publish ${article.title}`,
      branch
    );

    // Merge just this article's entry into the default branch's TOC.
    const mainTocFile = await getFile("content/toc.json", base);
    const mainToc = JSON.parse(mainTocFile.content) as Toc;
    const mergedToc = upsertArticleIntoToc(mainToc, workingToc, path);
    await putFile(
      "content/toc.json",
      JSON.stringify(mergedToc, null, 2),
      `Publish ${article.title} (TOC entry)`,
      branch
    );

    const prBody =
      `Publishing a single article: **${article.title}** (\`${path}\`).\n\n` +
      `This PR contains only the article body and its TOC entry. Shared ` +
      `resources (snippets, variables, glossary, images) it may reference are ` +
      `published separately via "Publish all" — verify any dependencies are ` +
      `already on \`${base}\`.`;
    const pr = await createPR(`Publish: ${article.title}`, prBody, branch, base);

    return NextResponse.json({
      branch,
      prUrl: pr.url,
      prNumber: pr.number,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to publish article";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
