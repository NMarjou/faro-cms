import { NextRequest, NextResponse } from "next/server";
import { putFile } from "@/lib/storage";
import { mutateJsonFile } from "@/lib/sidecar";
import { runWithProject, PROJECTS_CACHE_KEY } from "@/lib/request-context";
import { invalidate } from "@/lib/cache";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { isTechWriter } from "@/lib/permissions";
import { loadProjects, slugify, PROJECTS_PATH } from "@/lib/projects";
import type { Project, ProjectsData } from "@/lib/types";

/**
 * GET    /api/projects               — list the manifest (any signed-in user)
 * POST   /api/projects {name, slug?, publishTarget?} — create a project (tech-writer)
 * PATCH  /api/projects {slug, name?, description?, publishTarget?} — update (tech-writer)
 * DELETE /api/projects {slug}        — remove from manifest (tech-writer; not default/last)
 *
 * The manifest (CMS-content/projects.json) is project-independent. Writes go
 * through mutateJsonFile so concurrent edits don't clobber. Creating a project
 * seeds projects/<slug>/toc.json with an empty TOC. `publishTarget` sets the
 * project's working (draft) + base (publish) branches; manifest writes bust the
 * branch-resolution cache (request-context) so changes take effect at once.
 */

/** Normalize a publishTarget: trim, drop empty strings, undefined if nothing left. */
function normPublishTarget(
  pt?: { workingBranch?: string; baseBranch?: string }
): Project["publishTarget"] {
  if (!pt) return undefined;
  const out: { workingBranch?: string; baseBranch?: string } = {};
  const wb = pt.workingBranch?.trim();
  const bb = pt.baseBranch?.trim();
  if (wb) out.workingBranch = wb;
  if (bb) out.baseBranch = bb;
  return Object.keys(out).length ? out : undefined;
}

export async function GET() {
  return NextResponse.json({ projects: await loadProjects() });
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    const body = (await request.json()) as {
      name?: string; slug?: string; description?: string;
      publishTarget?: { workingBranch?: string; baseBranch?: string };
    };
    const name = (body.name || "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const slug = slugify(body.slug || name);
    if (!slug) return NextResponse.json({ error: "could not derive a valid slug" }, { status: 400 });

    if ((await loadProjects()).some((p) => p.slug === slug)) {
      return NextResponse.json({ error: `A project with slug "${slug}" already exists` }, { status: 409 });
    }

    const entry: Project = {
      slug,
      name,
      description: body.description?.trim() || undefined,
      publishTarget: normPublishTarget(body.publishTarget),
    };
    await mutateJsonFile<ProjectsData>(
      PROJECTS_PATH,
      (cur) => ({ projects: [...(cur?.projects ?? []), entry] }),
      `Create project ${name}`
    );
    invalidate(PROJECTS_CACHE_KEY);

    // Seed the new project's TOC (target THAT project, not the caller's).
    await runWithProject(slug, () =>
      putFile("content/toc.json", JSON.stringify({ categories: [] }, null, 2), `Seed ${name} TOC`)
    );

    return NextResponse.json({ project: entry });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to create project";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    const body = (await request.json()) as {
      slug?: string; name?: string; description?: string;
      publishTarget?: { workingBranch?: string; baseBranch?: string };
    };
    if (!body.slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
    const data = await mutateJsonFile<ProjectsData>(
      PROJECTS_PATH,
      (cur) => ({
        projects: (cur?.projects ?? []).map((p) =>
          p.slug === body.slug
            ? {
                ...p,
                ...(body.name?.trim() ? { name: body.name.trim() } : {}),
                ...(body.description !== undefined
                  ? { description: body.description.trim() || undefined }
                  : {}),
                // publishTarget omitted → unchanged; present → replace (empty clears).
                ...(body.publishTarget !== undefined
                  ? { publishTarget: normPublishTarget(body.publishTarget) }
                  : {}),
              }
            : p
        ),
      }),
      `Update project ${body.slug}`
    );
    invalidate(PROJECTS_CACHE_KEY);
    return NextResponse.json({ projects: data.projects });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to update project";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    const body = (await request.json()) as { slug?: string };
    if (!body.slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });

    const projects = await loadProjects();
    const target = projects.find((p) => p.slug === body.slug);
    if (!target) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (target.default) {
      return NextResponse.json({ error: "Cannot delete the default project" }, { status: 409 });
    }
    if (projects.length <= 1) {
      return NextResponse.json({ error: "Cannot delete the last project" }, { status: 409 });
    }

    // Remove from the manifest only — the project's files are left in place
    // (recoverable). A later phase can offer hard deletion.
    const data = await mutateJsonFile<ProjectsData>(
      PROJECTS_PATH,
      (cur) => ({ projects: (cur?.projects ?? []).filter((p) => p.slug !== body.slug) }),
      `Remove project ${body.slug}`
    );
    invalidate(PROJECTS_CACHE_KEY);
    return NextResponse.json({ projects: data.projects });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to delete project";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
