import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile } from "@/lib/storage";
import { mutateJsonFile } from "@/lib/sidecar";
import { getRequestUser, forbidden } from "@/lib/server-auth";

/**
 * GET    /api/article/comments?path=<articleFile>
 * POST   /api/article/comments  { path, comment }   — add
 * PATCH  /api/article/comments  { path, comment }    — replace by id (edit/reply/resolve)
 * DELETE /api/article/comments  { path, id }         — remove by id
 *
 * Comments persist in a sidecar file next to the article. Writes are
 * per-operation and server-merged through `mutateJsonFile`, so concurrent
 * reviewers' comments don't clobber each other (the old whole-array PUT let a
 * stale client array erase others' comments). Every write returns the
 * authoritative list so the client can reconcile.
 */

interface CommentRecord {
  id: string;
  [key: string]: unknown;
}
interface CommentsData {
  comments: CommentRecord[];
}

function sidecarPath(articleFile: string): string {
  const trimmed = articleFile.replace(/\.[a-zA-Z0-9]+$/, "");
  return `content/${trimmed}.comments.json`;
}

export async function GET(request: NextRequest) {
  setRequestProject(request);
  const path = request.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  try {
    const file = await getFile(sidecarPath(path));
    const data = JSON.parse(file.content);
    return NextResponse.json({ comments: Array.isArray(data.comments) ? data.comments : [] });
  } catch {
    // No sidecar yet — return empty rather than 404 so callers don't special-case
    // "first comment ever".
    return NextResponse.json({ comments: [] });
  }
}

/** Comments are a review activity for all roles — require a known user, no role gate. */
export async function POST(request: NextRequest) {
  setRequestProject(request);
  const caller = await getRequestUser(request);
  if (!caller) return forbidden();
  try {
    const { path, comment } = (await request.json()) as {
      path?: string;
      comment?: CommentRecord;
    };
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (!comment || typeof comment.id !== "string") {
      return NextResponse.json({ error: "comment with an id is required" }, { status: 400 });
    }
    const data = await mutateJsonFile<CommentsData>(
      sidecarPath(path),
      (cur) => ({ comments: [...(cur?.comments ?? []), comment] }),
      `Add comment on ${path}`
    );
    return NextResponse.json({ comments: data.comments });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to add comment";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  setRequestProject(request);
  const caller = await getRequestUser(request);
  if (!caller) return forbidden();
  try {
    const { path, comment } = (await request.json()) as {
      path?: string;
      comment?: CommentRecord;
    };
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (!comment || typeof comment.id !== "string") {
      return NextResponse.json({ error: "comment with an id is required" }, { status: 400 });
    }
    const data = await mutateJsonFile<CommentsData>(
      sidecarPath(path),
      (cur) => ({
        comments: (cur?.comments ?? []).map((c) => (c.id === comment.id ? comment : c)),
      }),
      `Update comment on ${path}`
    );
    return NextResponse.json({ comments: data.comments });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to update comment";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  setRequestProject(request);
  const caller = await getRequestUser(request);
  if (!caller) return forbidden();
  try {
    const { path, id } = (await request.json()) as { path?: string; id?: string };
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const data = await mutateJsonFile<CommentsData>(
      sidecarPath(path),
      (cur) => ({ comments: (cur?.comments ?? []).filter((c) => c.id !== id) }),
      `Delete comment on ${path}`
    );
    return NextResponse.json({ comments: data.comments });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to delete comment";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
