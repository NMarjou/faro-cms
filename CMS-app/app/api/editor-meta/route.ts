import { NextResponse } from "next/server";
import { getCachedFile, listFilesRecursive, SNIPPETS_LIST_PREFIX } from "@/lib/storage";
import { memoize } from "@/lib/cache";

/**
 * Bundles all editor-toolbar metadata into a single response so the editor
 * page makes one HTTP round-trip instead of five. Cuts both wall-clock
 * (browser 6-connection limit) and per-route dev-compile overhead.
 */

const CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
};

type EditorMeta = {
  variables: Record<string, string>;
  conditions: { tags: string[]; colors: Record<string, string> };
  glossary: { terms: unknown[] };
  styles: unknown[];
  snippetNames: string[];
};

async function loadJson(path: string): Promise<unknown | null> {
  try {
    const file = await getCachedFile(`content/${path}`);
    return JSON.parse(file.content);
  } catch {
    return null;
  }
}

async function loadVariables(): Promise<Record<string, string>> {
  const raw = (await loadJson("variables.json")) as
    | { sets?: { variables: Record<string, string> }[] }
    | Record<string, string>
    | null;
  if (!raw) return {};
  const sets = (raw as { sets?: { variables: Record<string, string> }[] }).sets;
  if (Array.isArray(sets)) {
    const flat: Record<string, string> = {};
    for (const set of sets) Object.assign(flat, set.variables);
    return flat;
  }
  return raw as Record<string, string>;
}

async function loadSnippetNames(): Promise<string[]> {
  return memoize(`${SNIPPETS_LIST_PREFIX}meta`, async () => {
    const files = await listFilesRecursive("content/snippets");
    return files
      .filter((f) => f.endsWith(".mdx") || f.endsWith(".html"))
      .map((f) => {
        const basename = f.split("/").pop() || f;
        return basename.replace(/\.(html|mdx)$/, "");
      });
  });
}

export async function GET() {
  const [variables, conditionsRaw, glossaryRaw, stylesRaw, snippetNames] =
    await Promise.all([
      loadVariables(),
      loadJson("conditions.json"),
      loadJson("glossary.json"),
      loadJson("styles.json"),
      loadSnippetNames(),
    ]);

  const conditions = (conditionsRaw as { tags?: string[]; colors?: Record<string, string> }) || {};
  const glossary = (glossaryRaw as { terms?: unknown[] }) || { terms: [] };

  const meta: EditorMeta = {
    variables,
    conditions: {
      tags: conditions.tags || [],
      colors: conditions.colors || {},
    },
    glossary: { terms: glossary.terms || [] },
    styles: Array.isArray(stylesRaw) ? stylesRaw : [],
    snippetNames,
  };

  return NextResponse.json(meta, { headers: CACHE_HEADERS });
}
