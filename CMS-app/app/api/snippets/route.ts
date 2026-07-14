import { NextRequest, NextResponse } from "next/server";
import { listOverridable, getFile, putFile, SNIPPETS_LIST_PREFIX, type AssetScope } from "@/lib/storage";
import { memoize } from "@/lib/cache";
import { setRequestProject } from "@/lib/request-context";
import { currentProjectSlug } from "@/lib/content-paths";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { isTechWriter } from "@/lib/permissions";
import matter from "gray-matter";
import { NO_STORE } from "@/lib/api-cache";

// `shared` distinguishes the shared-pool copy from a project-local override.
type SnippetEntry = { name: string; file: string; folder: string; shared: boolean };
type SnippetListing = { folders: string[]; snippets: SnippetEntry[] };

function basenameNoExt(filePath: string): string {
  const basename = filePath.split("/").pop() || filePath;
  return basename.replace(/\.(html|mdx)$/, "");
}

function extractSnippetName(content: string, filePath: string): string {
  const htmlMatch = content.match(/<!--\s*name:\s*(.+?)\s*-->/);
  if (htmlMatch) return htmlMatch[1];

  try {
    const { data } = matter(content);
    if (data.name) return data.name;
  } catch { /* not MDX */ }

  return basenameNoExt(filePath);
}

async function loadOrder(folder: string): Promise<string[]> {
  const orderPath = folder ? `content/snippets/${folder}/.order.json` : "content/snippets/.order.json";
  try {
    const file = await getFile(orderPath);
    return JSON.parse(file.content);
  } catch {
    return [];
  }
}

async function buildListing(full: boolean): Promise<SnippetListing> {
  // listOverridable returns the union of shared + project-local snippets (the
  // project override shadowing its shared twin) with each entry's origin.
  const entries = await listOverridable("content/snippets");
  const folderSet = new Set<string>();
  const candidates: { filePath: string; relPath: string; folder: string; scope: AssetScope }[] = [];

  for (const { file: filePath, scope } of entries) {
    const relPath = filePath.replace(/^content\//, "");
    const parts = relPath.replace(/^snippets\//, "").split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";

    if (folder) {
      const segments = folder.split("/");
      for (let i = 1; i <= segments.length; i++) {
        folderSet.add(segments.slice(0, i).join("/"));
      }
    }

    if (!filePath.endsWith(".mdx") && !filePath.endsWith(".html")) continue;
    candidates.push({ filePath, relPath, folder, scope });
  }

  // Lite mode (default for editor) derives names from filename — avoids
  // N+1 reads with hundreds of snippets. Full mode (snippets manager,
  // sidebar) reads each file to honor explicit `name:` frontmatter/comments,
  // but parallelized.
  let snippets: SnippetEntry[];
  if (full) {
    snippets = await Promise.all(
      candidates.map(async ({ filePath, relPath, folder, scope }) => {
        const shared = scope === "shared";
        try {
          const raw = await getFile(filePath);
          return { name: extractSnippetName(raw.content, filePath), file: relPath, folder, shared };
        } catch {
          return { name: basenameNoExt(filePath), file: relPath, folder, shared };
        }
      })
    );
  } else {
    snippets = candidates.map(({ filePath, relPath, folder, scope }) => ({
      name: basenameNoExt(filePath),
      file: relPath,
      folder,
      shared: scope === "shared",
    }));
  }

  // Apply per-folder ordering. Read all .order.json files in parallel.
  const folders = [...folderSet].sort();
  const allFolders = ["", ...folders];
  const orderEntries = await Promise.all(
    allFolders.map(async (f) => [f, await loadOrder(f)] as const)
  );
  const orderCache = new Map(orderEntries);

  snippets.sort((a, b) => {
    if (a.folder !== b.folder) return 0;
    const order = orderCache.get(a.folder) || [];
    if (order.length === 0) return 0;
    const aIdx = order.indexOf(a.file);
    const bIdx = order.indexOf(b.file);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  return { folders, snippets };
}

export async function GET(request: NextRequest) {
  await setRequestProject(request);
  const full = request.nextUrl.searchParams.get("full") === "1";

  try {
    // Project-keyed: the listing now differs per project (overrides shadow
    // shared), so a global key would serve one project's list to another.
    const data = await memoize(
      `${SNIPPETS_LIST_PREFIX}${currentProjectSlug()}:${full ? "full" : "lite"}`,
      () => buildListing(full)
    );
    return NextResponse.json(data, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ folders: [], snippets: [] }, { headers: NO_STORE });
  }
}

export async function PUT(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!isTechWriter(user?.role ?? null)) return forbidden();
  try {
    const body = await request.json();
    const { folder, order } = body as { folder: string; order: string[] };

    const orderPath = folder ? `snippets/${folder}/.order.json` : "snippets/.order.json";
    await putFile(
      `content/${orderPath}`,
      JSON.stringify(order, null, 2),
      `Update snippet order in ${folder || "root"}`
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save order";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
