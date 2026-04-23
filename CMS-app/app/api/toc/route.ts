import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile } from "@/lib/storage";

export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref") || undefined;

  try {
    const file = await getFile("content/toc.json", ref);
    return NextResponse.json(JSON.parse(file.content));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read TOC";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { toc, message, branch } = body;

    if (!toc) {
      return NextResponse.json({ error: "toc is required" }, { status: 400 });
    }

    const content = JSON.stringify(toc, null, 2);
    const result = await putFile(
      "content/toc.json",
      content,
      message || "Update table of contents",
      branch
    );

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to update TOC";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
