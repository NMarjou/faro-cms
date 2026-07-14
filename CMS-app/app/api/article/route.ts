import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getFile } from "@/lib/storage";
import matter from "gray-matter";

/**
 * GET /api/article?path=help/passport/overview.html
 * Returns article content. Detects format by extension and content.
 */
export async function GET(request: NextRequest) {
  await setRequestProject(request);
  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  try {
    const file = await getFile(`content/${filePath}`);
    const content = file.content.trim();

    // Sniff the BODY, not the extension or the presence of frontmatter. HTML
    // starts with a tag; anything else (frontmatter or bare markdown) is MDX.
    //
    // This used to say `|| !content.startsWith("---")` — "no frontmatter ⇒ HTML"
    // — which mis-detected a frontmatter-less markdown file as HTML. The editor
    // would then load it through the HTML path, rendering `# Heading` as literal
    // text and silently dropping <Var>/<MessageBox> components.
    const isHtml = content.startsWith("<") || (!content && filePath.endsWith(".html"));

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
