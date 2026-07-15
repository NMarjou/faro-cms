import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { getRequestUser, forbidden } from "@/lib/server-auth";
import { canPublish } from "@/lib/permissions";
import { NO_STORE } from "@/lib/api-cache";
import { loadZendeskMap, saveZendeskMap } from "@/lib/zendesk-map";
import { getZendeskConfig, listBrands } from "@/lib/zendesk";

/**
 * Which Zendesk BRAND this project publishes to.
 *
 * A multi-brand account has one help centre per brand, each on its own host.
 * Choosing the brand here (and persisting its host) is what makes "one project
 * per help centre" real — every bootstrap/sync call then routes to that host.
 *
 * GET  — list the account's brands + which one this project has selected.
 * POST — select a brand: { brandId }. The server re-fetches the brand list and
 *        records the brand's id AND host authoritatively (never trusts a host
 *        from the client), so routing can't be pointed somewhere unverified.
 */

export async function GET(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!canPublish(user?.role ?? null)) return forbidden("You don't have permission to publish");
  try {
    const map = await loadZendeskMap();
    const brands = await listBrands(getZendeskConfig());
    return NextResponse.json({ brands, selected: map.brandId ?? null }, { headers: NO_STORE });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to list brands";
    return NextResponse.json({ error: msg }, { status: /not configured/i.test(msg) ? 400 : 502 });
  }
}

export async function POST(request: NextRequest) {
  await setRequestProject(request);
  const user = await getRequestUser(request);
  if (!canPublish(user?.role ?? null)) return forbidden("You don't have permission to publish");
  try {
    const { brandId } = (await request.json().catch(() => ({}))) as { brandId?: number };
    if (!Number.isInteger(brandId) || (brandId as number) <= 0) {
      return NextResponse.json({ error: "A valid brandId is required" }, { status: 400 });
    }
    const brands = await listBrands(getZendeskConfig());
    const brand = brands.find((b) => b.id === brandId);
    if (!brand) return NextResponse.json({ error: `Brand ${brandId} not found on this account` }, { status: 404 });

    const map = await loadZendeskMap();
    // Changing brand after content is already mapped would point existing ids at
    // the wrong help centre. Refuse rather than silently corrupt the mapping.
    const alreadyMapped =
      Object.keys(map.categories).length + Object.keys(map.sections).length + Object.keys(map.articles).length > 0;
    if (map.brandId && map.brandId !== brand.id && alreadyMapped) {
      return NextResponse.json(
        { error: "This project already has structure mapped to another brand. Changing brand would orphan those ids." },
        { status: 409 }
      );
    }
    map.brandId = brand.id;
    map.brandHost = brand.host;
    await saveZendeskMap(map, `Select Zendesk brand: ${brand.name}`);
    return NextResponse.json({ selected: brand.id, host: brand.host, name: brand.name }, { headers: NO_STORE });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to select brand";
    return NextResponse.json({ error: msg }, { status: /not configured/i.test(msg) ? 400 : 502 });
  }
}
