import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { isOverridable } from "@/lib/content-paths";
import { makeProjectSpecific, revertToShared, hasProjectOverride, hasSharedFile } from "@/lib/storage";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { isTechWriter } from "@/lib/permissions";

/**
 * Per-project override of a shared snippet.
 *   POST   { file }  → "Make project-specific": fork the shared copy into the
 *                       current project (projects/<slug>/<file>).
 *   DELETE ?file=…    → "Revert to shared": delete the project-local copy.
 * `file` is a content-relative path, e.g. `snippets/warnings/data-loss.html`.
 */

// This is the SNIPPETS override endpoint — accept only snippet paths (not any
// overridable asset), so it can't be used to fork images past their own gate.
function normalize(file: unknown): string | null {
  if (typeof file !== "string" || !file.trim()) return null;
  const rel = file.replace(/^content\//, "");
  if (!rel.startsWith("snippets/") || !isOverridable(rel) || rel.includes("..")) return null;
  return rel;
}

export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    const { file } = (await request.json()) as { file?: string };
    const rel = normalize(file);
    if (!rel) return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    if (await hasProjectOverride(rel)) {
      return NextResponse.json({ scope: "project", alreadyOverridden: true });
    }
    if (!(await hasSharedFile(rel))) {
      return NextResponse.json({ error: "Snippet not found" }, { status: 404 });
    }
    await makeProjectSpecific(rel);
    return NextResponse.json({ scope: "project" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fork snippet";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    const rel = normalize(request.nextUrl.searchParams.get("file"));
    if (!rel) return NextResponse.json({ error: "Invalid file" }, { status: 400 });
    await revertToShared(rel);
    return NextResponse.json({ scope: "shared" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to revert snippet";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
