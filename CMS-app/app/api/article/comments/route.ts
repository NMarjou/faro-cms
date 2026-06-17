import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile } from "@/lib/storage";
import { getRequestUser, forbidden } from "@/lib/server-auth";

/**
 * GET  /api/article/comments?path=<articleFile>
 * PUT  /api/article/comments  body: { path, comments[], message? }
 *
 * Comments persist in a sidecar file next to the article. For an article at
 * `help/passport/getting-started.mdx`, comments live at
 * `help/passport/getting-started.comments.json` (storage layer maps these to
 * `CMS-content/...` on disk / `CMS-content/...` on GitHub).
 */

function sidecarPath(articleFile: string): string {
  // Strip the article extension and append `.comments.json`. Handles `.mdx`,
  // `.md`, `.html`, `.htm`, anything else with a dot — falls back to suffix.
  const trimmed = articleFile.replace(/\.[a-zA-Z0-9]+$/, "");
  return `content/${trimmed}.comments.json`;
}

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  try {
    const file = await getFile(sidecarPath(path));
    const data = JSON.parse(file.content);
    return NextResponse.json({ comments: Array.isArray(data.comments) ? data.comments : [] });
  } catch {
    // No sidecar yet — return empty list rather than 404 so callers don't
    // have to special-case "first comment ever".
    return NextResponse.json({ comments: [] });
  }
}

export async function PUT(request: NextRequest) {
  // Comments are a review activity shared by all roles (the editor
  // auto-persists them for any user who opens an article). Require a known
  // signed-in user, but don't restrict by role.
  const caller = await getRequestUser(request);
  if (!caller) return forbidden();
  try {
    const body = await request.json();
    const { path, comments, message } = body as {
      path?: string;
      comments?: unknown[];
      message?: string;
    };
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (!Array.isArray(comments)) {
      return NextResponse.json({ error: "comments array is required" }, { status: 400 });
    }

    const result = await putFile(
      sidecarPath(path),
      JSON.stringify({ comments }, null, 2),
      message ||
        (comments.length === 0
          ? `Clear comments on ${path}`
          : `Update comments on ${path} (${comments.length})`)
    );
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save comments";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
