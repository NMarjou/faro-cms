import { NextRequest, NextResponse } from "next/server";
import { listFilesRecursive, getFile, putFile } from "@/lib/storage";
import matter from "gray-matter";

function extractSnippetName(content: string, filePath: string): string {
  const htmlMatch = content.match(/<!--\s*name:\s*(.+?)\s*-->/);
  if (htmlMatch) return htmlMatch[1];

  try {
    const { data } = matter(content);
    if (data.name) return data.name;
  } catch { /* not MDX */ }

  const basename = filePath.split("/").pop() || filePath;
  return basename.replace(/\.(html|mdx)$/, "");
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

function sortByOrder(items: { name: string; file: string; folder: string }[], order: string[]): typeof items {
  if (order.length === 0) return items;
  const orderMap = new Map(order.map((f, i) => [f, i]));
  return [...items].sort((a, b) => {
    const aIdx = orderMap.get(a.file) ?? 999;
    const bIdx = orderMap.get(b.file) ?? 999;
    return aIdx - bIdx;
  });
}

export async function GET() {
  try {
    const files = await listFilesRecursive("content/snippets");
    const snippets: { name: string; file: string; folder: string }[] = [];
    const folderSet = new Set<string>();

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
      try {
        const raw = await getFile(filePath);
        snippets.push({
          name: extractSnippetName(raw.content, filePath),
          file: relPath,
          folder,
        });
      } catch {
        // skip
      }
    }

    // Apply per-folder ordering
    const folders = [...folderSet].sort();
    const allFolders = ["", ...folders];
    const orderCache = new Map<string, string[]>();
    for (const f of allFolders) {
      orderCache.set(f, await loadOrder(f));
    }

    const sortedSnippets = snippets.sort((a, b) => {
      if (a.folder !== b.folder) return 0;
      const order = orderCache.get(a.folder) || [];
      if (order.length === 0) return 0;
      const aIdx = order.indexOf(a.file);
      const bIdx = order.indexOf(b.file);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    return NextResponse.json({ folders, snippets: sortedSnippets });
  } catch {
    return NextResponse.json({ folders: [], snippets: [] });
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
