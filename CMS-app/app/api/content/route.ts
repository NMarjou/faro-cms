import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile, getCachedFile, putFile, deleteFile, resolvePhysicalSubpath } from "@/lib/storage";
import { getRequestUser, canWriteContentPath, forbidden } from "@/lib/server-auth";
import { syncArticleWorkflowOnSave } from "@/lib/article-workflow";

// Small metadata files the editor reads on every article open. Caching
// these via getCachedFile means hundreds of editor opens share one read;
// invalidation happens automatically in storage.putFile/deleteFile.
const CACHEABLE_PATHS = new Set([
  "conditions.json",
  "styles.json",
  "dictionary.json",
  "editor-styles.css",
]);

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
};

export async function GET(request: NextRequest) {
  await setRequestProject(request);
  const path = request.nextUrl.searchParams.get("path");
  const ref = request.nextUrl.searchParams.get("ref") || undefined;
  const raw = request.nextUrl.searchParams.get("raw");

  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  try {
    // Raw mode: serve binary files (images) directly
    if (raw) {
      const fs = await import("fs");
      const nodePath = await import("path");
      const CONTENT_ROOT = nodePath.resolve(process.cwd(), "..", "CMS-content");
      // Resolve through the project/shared layout, override-aware: a project's
      // forked image (projects/<slug>/images/…) wins over the shared copy.
      const fullPath = nodePath.join(CONTENT_ROOT, await resolvePhysicalSubpath(`content/${path}`));
      if (!fs.existsSync(fullPath)) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      const buffer = fs.readFileSync(fullPath);
      const ext = nodePath.extname(fullPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".svg": "image/svg+xml",
      };
      return new NextResponse(buffer, {
        headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream", "Cache-Control": "public, max-age=60" },
      });
    }

    const useCached = !ref && CACHEABLE_PATHS.has(path);
    const file = useCached
      ? await getCachedFile(`content/${path}`)
      : await getFile(`content/${path}`, ref);
    return NextResponse.json(file, useCached ? { headers: CACHE_HEADERS } : undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read file";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function PUT(request: NextRequest) {
  await setRequestProject(request);
  try {
    const body = await request.json();
    const { path, content, message, branch, sha } = body;

    if (!path || content === undefined || !message) {
      return NextResponse.json(
        { error: "path, content, and message are required" },
        { status: 400 }
      );
    }

    const user = await getRequestUser(request);
    if (!(await canWriteContentPath(path, user))) return forbidden();

    const result = await putFile(`content/${path}`, content, message, branch, sha);
    // Keep the TOC entry's workflow bookkeeping in sync server-side (bump
    // lastModified, reset sign-off/approval since the body changed). No-op for
    // non-article paths. Best-effort — a bookkeeping failure shouldn't fail the
    // body save that already succeeded.
    let workflow = {};
    try {
      workflow = await syncArticleWorkflowOnSave(path, user);
    } catch (err) {
      console.warn(`[content] workflow sync failed for ${path}:`, err);
    }
    return NextResponse.json({ ...result, ...workflow });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  await setRequestProject(request);
  try {
    const body = await request.json();
    const { path, message, branch } = body;

    if (!path || !message) {
      return NextResponse.json(
        { error: "path and message are required" },
        { status: 400 }
      );
    }

    const user = await getRequestUser(request);
    if (!(await canWriteContentPath(path, user))) return forbidden();

    await deleteFile(`content/${path}`, message, branch);
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to delete file";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
