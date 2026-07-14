import { NextRequest, NextResponse } from "next/server";
import Fuse from "fuse.js";
import { setRequestProject } from "@/lib/request-context";
import { currentProjectSlug } from "@/lib/content-paths";
import { buildSearchIndex } from "@/lib/search-index";
import type { SearchObjectType, SearchResult } from "@/lib/types";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache the built index PER PROJECT. The index unions shared + project objects,
// so it differs per project — a single global cache would serve one project's
// results under another (the previous, articles-only implementation's bug).
const caches = new Map<string, { index: Fuse<SearchResult>; time: number }>();

function buildFuse(entries: SearchResult[]): Fuse<SearchResult> {
  return new Fuse(entries, {
    keys: [
      { name: "title", weight: 3 }, // object name — matches rank highest
      { name: "keywords", weight: 2.5 }, // deliberate search aids (synonyms)
      { name: "tags", weight: 2 }, // article labels — find articles by tag
      { name: "summary", weight: 2 }, // the article's own description
      { name: "subtitle", weight: 1 },
      { name: "bodyText", weight: 1 }, // full text (articles, snippets, defs…)
    ],
    threshold: 0.35,
    ignoreLocation: true, // match anywhere in long bodies, not just the start
    includeScore: true,
    minMatchCharLength: 2,
  });
}

async function getIndex(): Promise<Fuse<SearchResult>> {
  const key = currentProjectSlug();
  const now = Date.now();
  const hit = caches.get(key);
  if (hit && now - hit.time < CACHE_TTL) return hit.index;

  const index = buildFuse(await buildSearchIndex());
  caches.set(key, { index, time: now });
  return index;
}

export async function GET(request: NextRequest) {
  await setRequestProject(request);
  const params = request.nextUrl.searchParams;
  const query = params.get("q")?.trim() ?? "";
  const typeFilter = params.get("type") as SearchObjectType | null;
  const limit = Math.min(Number(params.get("limit")) || 40, 100);

  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const index = await getIndex();
    const hits = index.search(query, { limit: typeFilter ? 200 : limit });
    let results: SearchResult[] = hits.map((h) => ({ ...h.item, score: h.score }));
    if (typeFilter) results = results.filter((r) => r.type === typeFilter).slice(0, limit);
    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
