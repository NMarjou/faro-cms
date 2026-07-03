import { NextRequest, NextResponse } from "next/server";
import { getCachedFile, putFile, writeProjectOverlay, deleteProjectOverlay } from "@/lib/storage";
import { setRequestProject } from "@/lib/request-context";
import { loadMergedVariableSets, loadMergedVariablesFlat } from "@/lib/merged-config";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { isTechWriter } from "@/lib/permissions";
import type { Variables, VariableSetsData } from "@/lib/types";

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
};

/** Read the SHARED variables.json and normalize to sets, migrating flat→sets. */
async function loadSharedSets(ref?: string): Promise<VariableSetsData> {
  try {
    const file = await getCachedFile("content/variables.json", ref);
    const data = JSON.parse(file.content);
    if (data.sets && Array.isArray(data.sets)) return data as VariableSetsData;

    // Old flat format — migrate the shared file to a single "General" set.
    const migrated: VariableSetsData = {
      sets: [{ name: "General", slug: "general", variables: data as Variables }],
    };
    await putFile(
      "content/variables.json",
      JSON.stringify(migrated, null, 2),
      "Migrate variables to sets format"
    );
    return migrated;
  } catch {
    return { sets: [] };
  }
}

export async function GET(request: NextRequest) {
  await setRequestProject(request);
  const ref = request.nextUrl.searchParams.get("ref") || undefined;
  const format = request.nextUrl.searchParams.get("format");
  const scope = request.nextUrl.searchParams.get("scope");

  if (format === "sets") {
    // scope=shared → the shared pool only (for editing shared without folding
    // in this project's overrides). Otherwise merged + per-key scope for the UI.
    if (scope === "shared") {
      return NextResponse.json(await loadSharedSets(ref), { headers: CACHE_HEADERS });
    }
    const { merged, scopes } = await loadMergedVariableSets(ref);
    return NextResponse.json({ ...merged, scopes }, { headers: CACHE_HEADERS });
  }

  // Default: flat merged object (backward compatible).
  return NextResponse.json(await loadMergedVariablesFlat(ref), { headers: CACHE_HEADERS });
}

export async function PUT(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    const scope = request.nextUrl.searchParams.get("scope") || "shared";
    const body = await request.json();

    // Both scopes accept sets format; project writes go to the sparse overlay,
    // shared writes go to the shared pool file (cross-project blast radius).
    if (body.sets) {
      const content = JSON.stringify({ sets: body.sets } as VariableSetsData, null, 2);
      if (scope === "project") {
        const result = await writeProjectOverlay(
          "variables.json",
          content,
          body.message || "Update project variable overrides"
        );
        return NextResponse.json(result);
      }
      const result = await putFile(
        "content/variables.json",
        content,
        body.message || "Update variable sets"
      );
      return NextResponse.json(result);
    }

    // Legacy flat format — shared only, wraps into the existing sets structure.
    if (body.variables) {
      const current = await loadSharedSets();
      if (current.sets.length === 1) {
        current.sets[0].variables = body.variables;
      } else {
        current.sets = [{ name: "General", slug: "general", variables: body.variables }];
      }
      const result = await putFile(
        "content/variables.json",
        JSON.stringify(current, null, 2),
        body.message || "Update variables"
      );
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "sets or variables is required" }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to update variables";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Clear this project's variable overrides entirely (revert to fully shared). */
export async function DELETE(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    await deleteProjectOverlay("variables.json", "Clear project variable overrides");
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to clear overrides";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
