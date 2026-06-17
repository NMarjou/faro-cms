import { NextRequest, NextResponse } from "next/server";
import { getCachedFile, putFile } from "@/lib/storage";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { isTechWriter } from "@/lib/permissions";
import type { Glossary } from "@/lib/types";

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
};

async function loadGlossary(): Promise<Glossary> {
  try {
    const file = await getCachedFile("content/glossary.json");
    return JSON.parse(file.content);
  } catch {
    return { terms: [] };
  }
}

export async function GET() {
  const glossary = await loadGlossary();
  return NextResponse.json(glossary, { headers: CACHE_HEADERS });
}

export async function PUT(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    const body = await request.json();
    const { glossary } = body;
    if (!glossary) {
      return NextResponse.json({ error: "glossary is required" }, { status: 400 });
    }
    await putFile(
      "content/glossary.json",
      JSON.stringify(glossary, null, 2),
      "Update glossary"
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save glossary";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
