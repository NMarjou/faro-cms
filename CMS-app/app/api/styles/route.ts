import { NextRequest, NextResponse } from "next/server";
import { getCachedFile, putFile, writeProjectOverlay, deleteProjectOverlay } from "@/lib/storage";
import { setRequestProject } from "@/lib/request-context";
import { loadMergedStyles } from "@/lib/merged-config";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { isTechWriter } from "@/lib/permissions";
import type { ContentStyle } from "@/lib/types";

/**
 * Paragraph/character styles (styles.json = ContentStyle[]), project-aware
 * (Phase 1 JSON-merge type). Previously read-only (no manager UI); this adds
 * shared + per-project overlay editing, keyed by CSS class.
 *   GET               → merged (shared + overlay) + per-class scope
 *   GET  ?scope=shared→ the shared pool only (for editing shared)
 *   PUT  ?scope=…     → shared writes the pool; project writes a sparse overlay
 *   DELETE ?scope=project → clear this project's style overrides
 */

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
};

async function loadSharedStyles(): Promise<ContentStyle[]> {
  try {
    const data = JSON.parse((await getCachedFile("content/styles.json")).content);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  setRequestProject(request);
  if (request.nextUrl.searchParams.get("scope") === "shared") {
    return NextResponse.json({ styles: await loadSharedStyles() }, { headers: CACHE_HEADERS });
  }
  const { merged, scopes } = await loadMergedStyles();
  return NextResponse.json({ styles: merged, scopes }, { headers: CACHE_HEADERS });
}

export async function PUT(request: NextRequest) {
  setRequestProject(request);
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    const scope = request.nextUrl.searchParams.get("scope") || "shared";
    const { styles } = (await request.json()) as { styles?: ContentStyle[] };
    if (!Array.isArray(styles)) {
      return NextResponse.json({ error: "styles is required" }, { status: 400 });
    }
    const content = JSON.stringify(styles, null, 2);
    if (scope === "project") {
      await writeProjectOverlay("styles.json", content, "Update project style overrides");
    } else {
      await putFile("content/styles.json", content, "Update styles");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save styles";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Clear this project's style overrides entirely (revert to fully shared). */
export async function DELETE(request: NextRequest) {
  setRequestProject(request);
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    await deleteProjectOverlay("styles.json", "Clear project style overrides");
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to clear overrides";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
