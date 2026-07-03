import { NextRequest, NextResponse } from "next/server";
import { getCachedFile, putFile, writeProjectOverlay, deleteProjectOverlay } from "@/lib/storage";
import { setRequestProject } from "@/lib/request-context";
import { loadMergedConditions } from "@/lib/merged-config";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { isTechWriter } from "@/lib/permissions";
import type { ConditionsConfig } from "@/lib/types";

/**
 * Condition tags + colors, project-aware (Phase 1 JSON-merge type).
 *   GET               → merged (shared + this project's overlay) + per-tag scope
 *   GET  ?scope=shared→ the shared pool only (for editing shared)
 *   PUT  ?scope=…     → shared writes the pool; project writes a sparse overlay
 *                       ({tags: project-only, colors: overridden/project tags})
 *   DELETE ?scope=project → clear this project's condition overrides
 * Tags/colors previously lived at /api/content?path=conditions.json; this route
 * adds the overlay merge that the generic content endpoint can't express.
 */

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
};

async function loadSharedConditions(): Promise<ConditionsConfig> {
  try {
    const data = JSON.parse((await getCachedFile("content/conditions.json")).content);
    return {
      tags: Array.isArray(data?.tags) ? data.tags : [],
      colors: data?.colors && typeof data.colors === "object" ? data.colors : {},
    };
  } catch {
    return { tags: [], colors: {} };
  }
}

export async function GET(request: NextRequest) {
  await setRequestProject(request);
  if (request.nextUrl.searchParams.get("scope") === "shared") {
    return NextResponse.json(await loadSharedConditions(), { headers: CACHE_HEADERS });
  }
  const { merged, scopes } = await loadMergedConditions();
  return NextResponse.json({ ...merged, scopes }, { headers: CACHE_HEADERS });
}

export async function PUT(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    const scope = request.nextUrl.searchParams.get("scope") || "shared";
    const body = (await request.json()) as ConditionsConfig;
    if (!Array.isArray(body?.tags)) {
      return NextResponse.json({ error: "tags is required" }, { status: 400 });
    }
    const content = JSON.stringify({ tags: body.tags, colors: body.colors ?? {} }, null, 2);
    if (scope === "project") {
      await writeProjectOverlay("conditions.json", content, "Update project condition overrides");
    } else {
      await putFile("content/conditions.json", content, "Update condition tags");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save conditions";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Clear this project's condition overrides entirely (revert to fully shared). */
export async function DELETE(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    await deleteProjectOverlay("conditions.json", "Clear project condition overrides");
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to clear overrides";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
