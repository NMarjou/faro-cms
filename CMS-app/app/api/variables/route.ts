import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile } from "@/lib/storage";
import type { Variables, VariableSet, VariableSetsData } from "@/lib/types";

/** Read raw variables.json and normalize to sets format */
async function loadSets(ref?: string): Promise<VariableSetsData> {
  try {
    const file = await getFile("content/variables.json", ref);
    const data = JSON.parse(file.content);

    // Already in sets format
    if (data.sets && Array.isArray(data.sets)) {
      return data as VariableSetsData;
    }

    // Old flat format — migrate to a single "General" set
    const flat = data as Variables;
    const migrated: VariableSetsData = {
      sets: [{ name: "General", slug: "general", variables: flat }],
    };

    // Persist the migration
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

/** Merge all sets into a flat key-value object */
function mergeFlat(data: VariableSetsData): Variables {
  const flat: Variables = {};
  for (const set of data.sets) {
    Object.assign(flat, set.variables);
  }
  return flat;
}

export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref") || undefined;
  const format = request.nextUrl.searchParams.get("format");

  const data = await loadSets(ref);

  if (format === "sets") {
    return NextResponse.json(data);
  }

  // Default: return flat merged object (backward compatible)
  return NextResponse.json(mergeFlat(data));
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // New sets format
    if (body.sets) {
      const content = JSON.stringify(body as VariableSetsData, null, 2);
      const result = await putFile(
        "content/variables.json",
        content,
        body.message || "Update variable sets"
      );
      return NextResponse.json(result);
    }

    // Legacy flat format — wrap in existing sets structure, replacing all
    if (body.variables) {
      const current = await loadSets();
      // If there's only one set, update it; otherwise replace all with a single set
      if (current.sets.length === 1) {
        current.sets[0].variables = body.variables;
      } else {
        current.sets = [{ name: "General", slug: "general", variables: body.variables }];
      }
      const content = JSON.stringify(current, null, 2);
      const result = await putFile(
        "content/variables.json",
        content,
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
