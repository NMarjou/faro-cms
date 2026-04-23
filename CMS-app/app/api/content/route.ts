import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile, deleteFile } from "@/lib/storage";

export async function GET(request: NextRequest) {
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
      const fullPath = nodePath.join(CONTENT_ROOT, path);
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

    const file = await getFile(`content/${path}`, ref);
    return NextResponse.json(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read file";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, content, message, branch, sha } = body;

    if (!path || content === undefined || !message) {
      return NextResponse.json(
        { error: "path, content, and message are required" },
        { status: 400 }
      );
    }

    const result = await putFile(`content/${path}`, content, message, branch, sha);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, message, branch } = body;

    if (!path || !message) {
      return NextResponse.json(
        { error: "path and message are required" },
        { status: 400 }
      );
    }

    await deleteFile(`content/${path}`, message, branch);
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to delete file";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
