import { NextRequest, NextResponse } from "next/server";
import { listFilesRecursive, getFile, putFile, SNIPPETS_LIST_PREFIX } from "@/lib/storage";
import { memoize } from "@/lib/cache";
import matter from "gray-matter";

type SnippetEntry = { name: string; file: string; folder: string };
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
  const files = await listFilesRecursive("content/snippets");
  const folderSet = new Set<string>();
  const candidates: { filePath: string; relPath: string; folder: string }[] = [];

  for (const filePath of files) {
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
    candidates.push({ filePath, relPath, folder });
  }

  // Lite mode (default for editor) derives names from filename — avoids
  // N+1 reads with hundreds of snippets. Full mode (snippets manager,
  // sidebar) reads each file to honor explicit `name:` frontmatter/comments,
  // but parallelized.
  let snippets: SnippetEntry[];
  if (full) {
    snippets = await Promise.all(
      candidates.map(async ({ filePath, relPath, folder }) => {
        try {
          const raw = await getFile(filePath);
          return { name: extractSnippetName(raw.content, filePath), file: relPath, folder };
        } catch {
          return { name: basenameNoExt(filePath), file: relPath, folder };
        }
      })
    );
  } else {
    snippets = candidates.map(({ filePath, relPath, folder }) => ({
      name: basenameNoExt(filePath),
      file: relPath,
      folder,
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

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
};

export async function GET(request: NextRequest) {
  const full = request.nextUrl.searchParams.get("full") === "1";

  try {
    const data = await memoize(
      `${SNIPPETS_LIST_PREFIX}${full ? "full" : "lite"}`,
      () => buildListing(full)
    );
    return NextResponse.json(data, { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json({ folders: [], snippets: [] }, { headers: CACHE_HEADERS });
  }
}

export async function PUT(request: NextRequest) {
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
