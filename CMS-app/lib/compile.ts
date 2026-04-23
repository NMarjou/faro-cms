import { getSnippet, getVariables } from "./content";
import type { Variables } from "./types";

/**
 * Resolve snippet references in article content.
 */
export async function resolveSnippets(
  content: string,
  format: "html" | "mdx",
  ref?: string,
  cache?: Map<string, string>
): Promise<{ resolved: string; snippets: string[] }> {
  const snippetCache = cache || new Map<string, string>();
  const usedSnippets: string[] = [];

  async function loadSnippet(name: string): Promise<string> {
    if (snippetCache.has(name)) return snippetCache.get(name)!;
    try {
      const snippet = await getSnippet(name, ref);
      const body = snippet.content.trim();
      snippetCache.set(name, body);
      return body;
    } catch {
      return `<!-- snippet not found: ${name} -->`;
    }
  }

  let resolved = content;

  if (format === "html") {
    const htmlPattern = /<div[^>]*data-node-type="snippet"[^>]*data-snippet="([^"]+)"[^>]*>[\s\S]*?<\/div>/g;
    const matches = [...content.matchAll(htmlPattern)];
    for (const match of matches) {
      const name = match[1];
      usedSnippets.push(name);
      const body = await loadSnippet(name);
      resolved = resolved.replace(match[0], body);
    }
  } else {
    const mdxPattern = /<Snippet\s+file="([^"]+)"\s*\/>/g;
    const matches = [...content.matchAll(mdxPattern)];
    for (const match of matches) {
      const name = match[1];
      usedSnippets.push(name);
      const body = await loadSnippet(name);
      resolved = resolved.replace(match[0], body);
    }
  }

  return { resolved, snippets: usedSnippets };
}

/**
 * Resolve variable references in article content, replacing them with actual values.
 */
export function resolveVariables(
  content: string,
  variables: Variables,
  format: "html" | "mdx"
): string {
  let resolved = content;

  if (format === "html") {
    // Match TipTap HTML: <span> with data-node-type="variable" and data-variable="NAME" (any attribute order)
    const htmlPattern = /<span[^>]*data-variable="([^"]+)"[^>]*data-node-type="variable"[^>]*>[^<]*<\/span>|<span[^>]*data-node-type="variable"[^>]*data-variable="([^"]+)"[^>]*>[^<]*<\/span>/g;
    resolved = resolved.replace(htmlPattern, (_match, name1: string, name2: string) => {
      const name = name1 || name2;
      return variables[name] ?? `{${name}}`;
    });
  } else {
    // Match MDX: <Var name="NAME" />
    const mdxPattern = /<Var\s+name="([^"]+)"\s*\/>/g;
    resolved = resolved.replace(mdxPattern, (_match, name: string) => {
      return variables[name] ?? `{${name}}`;
    });
  }

  return resolved;
}

/**
 * Resolve conditional blocks: keep content if any tag matches activeTags, strip otherwise.
 * If activeTags is empty or undefined, keep all conditional content.
 */
export function resolveConditionals(
  content: string,
  activeTags: string[] | undefined,
  format: "html" | "mdx"
): string {
  if (!activeTags || activeTags.length === 0) return content;

  let resolved = content;

  if (format === "html") {
    // Block-level: <div data-node-type="conditional" data-tags='[...]'>...inner...</div>
    const htmlBlockPattern = /<div[^>]*data-node-type="conditional"[^>]*>([\s\S]*?)<\/div>/g;
    resolved = resolved.replace(htmlBlockPattern, (match, inner: string) => {
      const tagsMatch = match.match(/data-tags='([^']*)'/);
      if (!tagsMatch) return inner;
      try {
        const tags: string[] = JSON.parse(tagsMatch[1]);
        return tags.some((t) => activeTags.includes(t)) ? inner : "";
      } catch { return inner; }
    });

    // Inline: <span data-mark-type="conditional" data-tags='[...]'>...inner...</span>
    const htmlInlinePattern = /<span[^>]*data-mark-type="conditional"[^>]*>([\s\S]*?)<\/span>/g;
    resolved = resolved.replace(htmlInlinePattern, (match, inner: string) => {
      const tagsMatch = match.match(/data-tags='([^']*)'/) || match.match(/data-tags="([^"]*)"/);
      if (!tagsMatch) return inner;
      try {
        const tags: string[] = JSON.parse(tagsMatch[1]);
        return tags.some((t) => activeTags.includes(t)) ? inner : "";
      } catch { return inner; }
    });
  } else {
    // Block-level MDX: <Conditional tags={[...]}>...inner...</Conditional>
    const mdxBlockPattern = /<Conditional\s+tags=\{(\[.*?\])\}\s*>([\s\S]*?)<\/Conditional>/g;
    resolved = resolved.replace(mdxBlockPattern, (_match, tagsJson: string, inner: string) => {
      try {
        const tags: string[] = JSON.parse(tagsJson);
        return tags.some((t) => activeTags.includes(t)) ? inner.trim() : "";
      } catch { return inner.trim(); }
    });

    // Inline MDX: <Cond tags={[...]}>text</Cond>
    const mdxInlinePattern = /<Cond\s+tags=\{(\[.*?\])\}>([\s\S]*?)<\/Cond>/g;
    resolved = resolved.replace(mdxInlinePattern, (_match, tagsJson: string, inner: string) => {
      try {
        const tags: string[] = JSON.parse(tagsJson);
        return tags.some((t) => activeTags.includes(t)) ? inner : "";
      } catch { return inner; }
    });
  }

  return resolved;
}

/**
 * Fully compile an article: resolve snippets, variables, and conditionals.
 */
export async function compileArticle(
  content: string,
  format: "html" | "mdx",
  ref?: string,
  snippetCache?: Map<string, string>,
  activeTags?: string[]
): Promise<{ html: string; snippets: string[] }> {
  const variables = await getVariables(ref);

  // 1. Resolve snippets (they may contain variables/conditionals)
  const { resolved: afterSnippets, snippets } = await resolveSnippets(
    content, format, ref, snippetCache
  );

  // 2. Resolve variables
  const afterVars = resolveVariables(afterSnippets, variables, format);

  // 3. Resolve conditionals
  const html = resolveConditionals(afterVars, activeTags, format);

  return { html, snippets };
}

/**
 * Create a shared snippet cache for batch compilation.
 */
export function createSnippetCache(): Map<string, string> {
  return new Map();
}
