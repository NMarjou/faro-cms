import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { setRequestProject } from "@/lib/request-context";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { canPublish } from "@/lib/permissions";
import { getFile, getFileBytes } from "@/lib/storage";
import { buildSiteBundle } from "@/lib/site-bundle";
import { renderSite } from "@/lib/site-render";

/**
 * POST /api/site/build   Body: { activeTags?: string[], report?: boolean }
 *
 * Builds the publishable static site for the current project and returns it as a
 * ZIP — a complete, self-contained site any host can serve (Vercel staging
 * today; the same bundle will feed the Zendesk sync).
 *
 * This is what "Publish Site — deploy static output to your host" always claimed
 * to do: previously the app compiled to HTML fragments and handed you a JSON
 * blob, with images still pointing at `/api/content?…` (dead outside the CMS).
 *
 * `report: true` returns the build report as JSON instead of the ZIP — broken
 * links, unfiled articles and asset count — so the UI can warn before download.
 */
export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!canPublish(user?.role ?? null)) return forbidden("You don't have permission to publish");

  try {
    const { activeTags, report } = (await request.json().catch(() => ({}))) as {
      activeTags?: string[];
      report?: boolean;
    };

    const bundle = await buildSiteBundle({
      activeTags: Array.isArray(activeTags) && activeTags.length ? activeTags : undefined,
    });

    if (report) {
      return NextResponse.json({
        pages: bundle.pages.length,
        assets: bundle.assets.length,
        brokenLinks: bundle.brokenLinks,
        // Unfiled articles have nowhere to live in a published site — and in
        // Zendesk an article cannot sit directly under a category at all.
        unfiled: bundle.unfiled,
      });
    }

    // The CMS's own content styles, so published pages look like the editor.
    let contentCss = "";
    try {
      contentCss = (await getFile("content/editor-styles.css")).content;
    } catch {
      /* none defined */
    }

    const zip = new JSZip();
    for (const [path, contents] of renderSite(bundle, contentCss)) zip.file(path, contents);

    // Copy the real asset bytes. Without this every image in the site 404s: the
    // CMS embeds them as /api/content?path=…&raw=1, a URL that doesn't exist on
    // any other host.
    for (const asset of bundle.assets) {
      try {
        zip.file(asset, await getFileBytes(`content/${asset}`));
      } catch {
        /* missing asset — the page keeps its rewritten src, reported as a build gap */
      }
    }

    const buf = await zip.generateAsync({ type: "nodebuffer" });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="site-${new Date().toISOString().split("T")[0]}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Site build failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
