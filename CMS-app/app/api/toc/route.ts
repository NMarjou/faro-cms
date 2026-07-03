import { NextRequest, NextResponse } from "next/server";
import { getCachedFile, putFile } from "@/lib/storage";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { isTechWriter } from "@/lib/permissions";
import { setRequestProject } from "@/lib/request-context";

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
};

export async function GET(request: NextRequest) {
  await setRequestProject(request);
  const ref = request.nextUrl.searchParams.get("ref") || undefined;

  try {
    const file = await getCachedFile("content/toc.json", ref);
    return NextResponse.json(JSON.parse(file.content), { headers: CACHE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read TOC";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
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
