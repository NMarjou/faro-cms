import { NextRequest, NextResponse } from "next/server";
import { getCachedFile, putFile, writeProjectOverlay, deleteProjectOverlay } from "@/lib/storage";
import { setRequestProject } from "@/lib/request-context";
import { loadMergedGlossary } from "@/lib/merged-config";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { isTechWriter } from "@/lib/permissions";
import type { Glossary } from "@/lib/types";

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
};

/** Read the SHARED glossary only (for editing shared without folding overrides). */
async function loadSharedGlossary(): Promise<Glossary> {
  try {
    const data = JSON.parse((await getCachedFile("content/glossary.json")).content);
    return { terms: Array.isArray(data?.terms) ? data.terms : [] };
  } catch {
    return { terms: [] };
  }
}

export async function GET(request: NextRequest) {
  setRequestProject(request);
  const scope = request.nextUrl.searchParams.get("scope");
  if (scope === "shared") {
    return NextResponse.json(await loadSharedGlossary(), { headers: CACHE_HEADERS });
  }
  // Merged (shared + this project's overlay) with per-term scope for the UI.
  const { merged, scopes } = await loadMergedGlossary();
  return NextResponse.json({ ...merged, scopes }, { headers: CACHE_HEADERS });
}

export async function PUT(request: NextRequest) {
  setRequestProject(request);
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    const scope = request.nextUrl.searchParams.get("scope") || "shared";
    const { glossary } = await request.json();
    if (!glossary) {
      return NextResponse.json({ error: "glossary is required" }, { status: 400 });
    }
    const content = JSON.stringify(glossary, null, 2);
    if (scope === "project") {
      // Sparse overlay: only this project's added/overridden terms.
      await writeProjectOverlay("glossary.json", content, "Update project glossary overrides");
    } else {
      await putFile("content/glossary.json", content, "Update glossary");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save glossary";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Clear this project's glossary overrides entirely (revert to fully shared). */
export async function DELETE(request: NextRequest) {
  setRequestProject(request);
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    await deleteProjectOverlay("glossary.json", "Clear project glossary overrides");
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to clear overrides";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
