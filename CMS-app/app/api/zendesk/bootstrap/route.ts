import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { canPublish } from "@/lib/permissions";
import { NO_STORE } from "@/lib/api-cache";
import { getToc } from "@/lib/content";
import { loadZendeskMap } from "@/lib/zendesk-map";
import { getZendeskConfig, listCategories, listSections } from "@/lib/zendesk";
import { reconcile } from "@/lib/zendesk-reconcile";

/**
 * POST /api/zendesk/bootstrap   Body: { locale?: string }
 *
 * READ-ONLY. Fetches the project's Zendesk help centre (categories + sections),
 * reconciles it against the Faro TOC and the project's saved id-map, and returns
 * the proposed match plan. Writes nothing — to Zendesk or the map.
 *
 * This is the derisking step: three help centres already hold live content, and
 * a wrong first match means a later sync overwrites the wrong article with no
 * undo. So the match is proposed here and a human confirms it before any id is
 * persisted.
 */
export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!canPublish(user?.role ?? null)) return forbidden("You don't have permission to publish");

  try {
    const { locale: bodyLocale } = (await request.json().catch(() => ({}))) as { locale?: string };

    const map = await loadZendeskMap();
    const locale = bodyLocale || map.locale || "en-us";

    const cfg = getZendeskConfig();
    const [categories, sections] = await Promise.all([
      listCategories(cfg, locale),
      listSections(cfg, locale),
    ]);

    const toc = await getToc();
    const plan = reconcile(toc, { categories, sections }, map);

    return NextResponse.json(
      {
        locale,
        existing: { categories: categories.length, sections: sections.length },
        plan,
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Bootstrap failed";
    // A missing/invalid Zendesk config is a 400 (fix your env), not a 500.
    const status = /not configured/i.test(msg) ? 400 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
