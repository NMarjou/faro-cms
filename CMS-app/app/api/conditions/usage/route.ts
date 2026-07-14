import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { buildConditionUsage } from "@/lib/conditions-usage";

/**
 * GET /api/conditions/usage → { usage: { [tag]: { labels: [], inline: [] } } }
 *
 * Which articles use each condition tag, as a label and/or inline in their body.
 * The conditions manager needs this before it can safely offer delete: removing
 * a tag that's still used inline silently strips that content from every
 * published build (see lib/conditions-usage.ts).
 *
 * Reads every article body, so it's the same cost as building the search index —
 * short browser cache, and it's only hit by the manager page.
 */
export async function GET(request: NextRequest) {
  await setRequestProject(request);
  try {
    const usage = await buildConditionUsage();
    return NextResponse.json(
      { usage },
      { headers: { "Cache-Control": "private, max-age=30" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to compute usage";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
