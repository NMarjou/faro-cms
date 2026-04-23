import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { putFile } from "@/lib/storage";

const CONTENT_ROOT = path.resolve(process.cwd(), "..", "CMS-content");
const isLocal = !process.env.GITHUB_TOKEN;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const folder = (formData.get("folder") as string) || "";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const allowed = ["image/png", "image/svg+xml", "image/jpeg", "image/gif"];
    if (!allowed.includes(file.type)) {
      return NextResponse.json(
        { error: "Only PNG, SVG, JPEG, GIF are allowed" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const filePath = folder ? `images/${folder}/${safeName}` : `images/${safeName}`;

    if (isLocal) {
      const dir = path.dirname(path.join(CONTENT_ROOT, filePath));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(CONTENT_ROOT, filePath), buffer);
    } else {
      await putFile(
        `content/${filePath}`,
        buffer.toString("base64"),
        `Upload image: ${safeName}`
      );
    }

    return NextResponse.json({ path: `/${filePath}`, file: filePath });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
