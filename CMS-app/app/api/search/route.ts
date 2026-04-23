import { NextRequest, NextResponse } from "next/server";
import Fuse from "fuse.js";
import { getToc, buildSearchEntries } from "@/lib/content";
import type { SearchEntry } from "@/lib/types";

let cachedIndex: Fuse<SearchEntry> | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getSearchIndex(): Promise<Fuse<SearchEntry>> {
  const now = Date.now();
  if (cachedIndex && now - cacheTime < CACHE_TTL) {
    return cachedIndex;
  }

  const toc = await getToc();
  const entries = await buildSearchEntries(toc);

  cachedIndex = new Fuse(entries, {
    keys: [
      { name: "title", weight: 2 },
      { name: "bodyText", weight: 1 },
      { name: "category", weight: 0.5 },
    ],
    threshold: 0.3,
    includeScore: true,
    minMatchCharLength: 2,
  });
  cacheTime = now;

  return cachedIndex;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const index = await getSearchIndex();
    const results = index.search(query, { limit: 20 });

    return NextResponse.json({
      results: results.map((r) => ({
        ...r.item,
        score: r.score,
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
