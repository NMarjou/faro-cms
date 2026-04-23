import { NextRequest, NextResponse } from "next/server";
import { listFilesRecursive, getFile, putFile } from "@/lib/storage";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg"];

async function loadOrder(folder: string): Promise<string[]> {
  const orderPath = folder ? `content/images/${folder}/.order.json` : "content/images/.order.json";
  try {
    const file = await getFile(orderPath);
    return JSON.parse(file.content);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const files = await listFilesRecursive("content/images");
    const images: { name: string; file: string; folder: string }[] = [];
    const folderSet = new Set<string>();

    for (const filePath of files) {
      const relPath = filePath.replace(/^content\//, "");
      const parts = relPath.replace(/^images\//, "").split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";

      if (folder) {
        const segments = folder.split("/");
        for (let i = 1; i <= segments.length; i++) {
          folderSet.add(segments.slice(0, i).join("/"));
        }
      }

      const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
      if (!IMAGE_EXTENSIONS.includes(ext)) continue;

      const name = filePath.split("/").pop() || filePath;
      images.push({ name, file: relPath, folder });
    }

    // Apply per-folder ordering
    const folders = [...folderSet].sort();
    const allFolders = ["", ...folders];
    for (const f of allFolders) {
      const order = await loadOrder(f);
      if (order.length === 0) continue;
      const orderMap = new Map(order.map((id, i) => [id, i]));
      images.sort((a, b) => {
        if (a.folder !== f || b.folder !== f) return 0;
        return (orderMap.get(a.file) ?? 999) - (orderMap.get(b.file) ?? 999);
      });
    }

    return NextResponse.json({ folders, images });
  } catch {
    return NextResponse.json({ folders: [], images: [] });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { folder, order } = body as { folder: string; order: string[] };

    const orderPath = folder ? `images/${folder}/.order.json` : "images/.order.json";
    await putFile(
      `content/${orderPath}`,
      JSON.stringify(order, null, 2),
      `Update image order in ${folder || "root"}`
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save order";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
