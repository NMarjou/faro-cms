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

/** First Zendesk id claimed by more than one Faro key, or null. Ids are unique
 *  per object type, so categories and sections are checked separately. */
function firstDuplicate(mapping: Record<string, number>): { id: number; keys: string[] } | null {
  const byId = new Map<number, string[]>();
  for (const [key, id] of Object.entries(mapping)) {
    const keys = byId.get(id) ?? byId.set(id, []).get(id)!;
    keys.push(key);
    if (keys.length > 1) return { id, keys };
  }
  return null;
}

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

    // reconcile() guarantees auto-matched ids are unique, but the ambiguous →
    // user-pick path bypasses that: a person can pick the same Zendesk object for
    // two Faro nodes. One Zendesk object driven by two sources = the sync
    // overwrites one with the other. Refuse rather than persist the collision.
    const dup = firstDuplicate(map.categories) ?? firstDuplicate(map.sections);
    if (dup) {
      return NextResponse.json(
        { error: `Two items are mapped to the same Zendesk id #${dup.id} (${dup.keys.join(", ")}). Each Zendesk object can back only one Faro item.` },
        { status: 409, headers: NO_STORE }
      );
    }

    await saveZendeskMap(map, "Confirm Zendesk matches");
    return NextResponse.json(map, { headers: NO_STORE });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save map";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
