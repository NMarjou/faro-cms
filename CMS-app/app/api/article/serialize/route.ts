import { NextRequest, NextResponse } from "next/server";
import { serializeToMdx } from "@/lib/editor/serialize";

/**
 * POST /api/article/serialize
 * Converts TipTap JSON + frontmatter back to MDX string.
 * Runs server-side so gray-matter works correctly.
 */
export async function POST(request: NextRequest) {
  try {
    const { doc, frontmatter } = await request.json();
    if (!doc || !frontmatter) {
      return NextResponse.json(
        { error: "doc and frontmatter are required" },
        { status: 400 }
      );
    }
    const mdx = serializeToMdx(doc, frontmatter);
    return NextResponse.json({ mdx });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Serialize failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
