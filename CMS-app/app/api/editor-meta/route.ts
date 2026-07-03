import { NextRequest, NextResponse } from "next/server";
import { setRequestProject } from "@/lib/request-context";
import { currentProjectSlug } from "@/lib/content-paths";
import { listFilesRecursive, SNIPPETS_LIST_PREFIX } from "@/lib/storage";
import { loadMergedVariablesFlat, loadMergedGlossary, loadMergedConditions, loadMergedStyles } from "@/lib/merged-config";
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

async function loadVariables(): Promise<Record<string, string>> {
  // Merges the current project's overlay over shared (flattened) for the editor.
  return loadMergedVariablesFlat();
}

async function loadSnippetNames(): Promise<string[]> {
  return memoize(`${SNIPPETS_LIST_PREFIX}${currentProjectSlug()}:meta`, async () => {
    const files = await listFilesRecursive("content/snippets");
    return files
      .filter((f) => f.endsWith(".mdx") || f.endsWith(".html"))
      .map((f) => {
        const basename = f.split("/").pop() || f;
        return basename.replace(/\.(html|mdx)$/, "");
      });
  });
}

export async function GET(request: NextRequest) {
  setRequestProject(request);
  const [variables, conditionsMerged, glossaryMerged, stylesMerged, snippetNames] =
    await Promise.all([
      loadVariables(),
      loadMergedConditions(),
      loadMergedGlossary(),
      loadMergedStyles(),
      loadSnippetNames(),
    ]);

  const meta: EditorMeta = {
    variables,
    conditions: {
      tags: conditionsMerged.merged.tags,
      colors: conditionsMerged.merged.colors || {},
    },
    glossary: { terms: glossaryMerged.merged.terms },
    styles: stylesMerged.merged,
    snippetNames,
  };

  return NextResponse.json(meta, { headers: CACHE_HEADERS });
}
