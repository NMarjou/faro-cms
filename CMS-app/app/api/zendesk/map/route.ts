import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { canPublish } from "@/lib/permissions";
import { NO_STORE } from "@/lib/api-cache";
import { loadZendeskMap, saveZendeskMap } from "@/lib/zendesk-map";

/**
 * The project's Zendesk id-map.
 *
 * GET  — read the current map (what identity is already locked).
 * PUT  — persist CONFIRMED matches from the review screen. This is the moment a
 *        proposed match ("matched"/an ambiguous pick) becomes a committed id, so
 *        names stop mattering and the sync updates in place instead of cloning.
 *
 * Writing the map is safe and reversible (it's a file in the project); the
 * IRREVERSIBLE part — creating and publishing in Zendesk — is a separate route.
 * We never touch the `articles` bucket here: that's the sync's to own.
 */

export async function GET(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!canPublish(user?.role ?? null)) return forbidden("You don't have permission to publish");
  const map = await loadZendeskMap();
  return NextResponse.json(map, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!canPublish(user?.role ?? null)) return forbidden("You don't have permission to publish");

  try {
    const body = (await request.json().catch(() => ({}))) as {
      brandId?: number;
      locale?: string;
      categories?: Record<string, number>;
      sections?: Record<string, number>;
    };

    const map = await loadZendeskMap();
    if (typeof body.brandId === "number") map.brandId = body.brandId;
    if (body.locale) map.locale = body.locale;
    // Merge confirmed ids in. A caller can re-confirm a subset without wiping the
    // rest, and an entry set to a falsy/invalid id is dropped rather than stored.
    for (const [slug, id] of Object.entries(body.categories ?? {})) {
      if (Number.isInteger(id) && id > 0) map.categories[slug] = id;
    }
    for (const [path, id] of Object.entries(body.sections ?? {})) {
      if (Number.isInteger(id) && id > 0) map.sections[path] = id;
    }

    await saveZendeskMap(map, "Confirm Zendesk matches");
    return NextResponse.json(map, { headers: NO_STORE });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save map";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
