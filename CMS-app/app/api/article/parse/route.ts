import { NextRequest, NextResponse } from "next/server";
import { deserializeFromMdx } from "@/lib/editor/deserialize";

/**
 * POST /api/article/parse
 * Parses MDX string into TipTap JSON content + frontmatter.
 * Runs server-side so gray-matter works correctly.
 */
export async function POST(request: NextRequest) {
  try {
    const { mdx } = await request.json();
    if (!mdx) {
      return NextResponse.json({ error: "mdx is required" }, { status: 400 });
    }
    const result = deserializeFromMdx(mdx);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Parse failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
