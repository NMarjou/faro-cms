import { NextRequest, NextResponse } from "next/server";
import { getFile } from "@/lib/storage";
import matter from "gray-matter";

/**
 * GET /api/article?path=help/passport/overview.html
 * Returns article content. Detects format by extension and content.
 */
export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  try {
    const file = await getFile(`content/${filePath}`);
    const content = file.content.trim();

    // Treat as HTML if: .html extension, OR content starts with an HTML tag (no frontmatter)
    const isHtml =
      filePath.endsWith(".html") ||
      content.startsWith("<") ||
      !content.startsWith("---");

    if (isHtml) {
      return NextResponse.json({
        content: file.content,
        format: "html",
      });
    }

    // MDX: has frontmatter (starts with ---)
    const { data, content: body } = matter(file.content);
    return NextResponse.json({
      frontmatter: data,
      content: body,
      raw: file.content,
      format: "mdx",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load article";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
