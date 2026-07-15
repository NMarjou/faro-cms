import { getSnippet, getVariables } from "./content";
import type { Variables } from "./types";

/**
 * Compilation is HTML-only.
 *
 * The editor is TipTap and always saves HTML, so HTML is the storage format for
 * every article and snippet. These functions used to branch on a `format`
 * ("html" | "mdx") and carry a parallel set of MDX patterns (<Snippet/>, <Var/>,
 * <Conditional>, <Cond>) — but no producer ever emitted MDX, so that half was
 * unreachable. Markdown/MDX now only exists as an *input* (see
 * lib/editor/deserialize.ts), converted to HTML on load.
 */

/** Resolve snippet references, inlining each snippet's body. */
export async function resolveSnippets(
  content: string,
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
  const pattern = /<div[^>]*data-node-type="snippet"[^>]*data-snippet="([^"]+)"[^>]*>[\s\S]*?<\/div>/g;
  for (const match of [...content.matchAll(pattern)]) {
    const name = match[1];
    usedSnippets.push(name);
    resolved = resolved.replace(match[0], await loadSnippet(name));
  }

  return { resolved, snippets: usedSnippets };
}

/** Replace variable nodes with their values (unknown names stay as {name}). */
export function resolveVariables(content: string, variables: Variables): string {
  // TipTap emits <span> with data-node-type="variable" + data-variable="NAME"
  // (attribute order isn't guaranteed, hence the two alternatives).
  const pattern = /<span[^>]*data-variable="([^"]+)"[^>]*data-node-type="variable"[^>]*>[^<]*<\/span>|<span[^>]*data-node-type="variable"[^>]*data-variable="([^"]+)"[^>]*>[^<]*<\/span>/g;
  return content.replace(pattern, (_match, name1: string, name2: string) => {
    const name = name1 || name2;
    return variables[name] ?? `{${name}}`;
  });
}

/**
 * Read `data-tags` off an opening tag.
 *
 * The editor writes it HTML-ESCAPED and double-quoted:
 *   data-tags="[&quot;advanced&quot;]"
 * The old implementation only looked for a single-quoted `data-tags='…'`, and
 * when it did match, JSON.parse choked on the `&quot;` entities and the catch
 * fell back to KEEPING the content. Result: conditional content was never
 * stripped — gated material (e.g. admin-only) shipped to every audience.
 */
export function parseTags(openTag: string): string[] | null {
  const m = openTag.match(/data-tags=(?:'([^']*)'|"([^"]*)")/i);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  try {
    const tags = JSON.parse(raw);
    return Array.isArray(tags) ? tags.map(String) : null;
  } catch {
    return null;
  }
}

/**
 * Replace every `<tagName>` element whose opening tag matches `openRe`, using a
 * depth counter to find its true closing tag. A regex can't do this: conditional
 * blocks nest <div>s (label chip + content), so a non-greedy `…</div>` match
 * ends at the wrong boundary and leaves gated content orphaned in the output.
 */
function replaceBalanced(
  html: string,
  tagName: "div" | "span",
  openRe: RegExp,
  decide: (tags: string[] | null, inner: string) => string
): string {
  const openAny = new RegExp(`<${tagName}\\b`, "gi");
  const closeAny = new RegExp(`</${tagName}\\s*>`, "gi");
  let out = "";
  let cursor = 0;
  openRe.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html)) !== null) {
    if (m.index < cursor) continue; // already consumed as part of an outer block
    out += html.slice(cursor, m.index);

    const openTag = m[0];
    let depth = 1;
    let pos = m.index + openTag.length;
    let closeStart = -1;
    let closeEnd = -1;

    while (pos < html.length && depth > 0) {
      openAny.lastIndex = pos;
      closeAny.lastIndex = pos;
      const o = openAny.exec(html);
      const c = closeAny.exec(html);
      if (!c) break; // unbalanced — bail out below
      if (o && o.index < c.index) {
        depth++;
        pos = o.index + o[0].length;
      } else {
        depth--;
        pos = c.index + c[0].length;
        if (depth === 0) { closeStart = c.index; closeEnd = pos; }
      }
    }

    if (closeStart === -1) { out += html.slice(m.index); return out; } // malformed
    out += decide(parseTags(openTag), html.slice(m.index + openTag.length, closeStart));
    cursor = closeEnd;
    openRe.lastIndex = cursor;
  }

  return out + html.slice(cursor);
}

/**
 * Drop the editor's conditional-block label chip ("⚡ advanced") — authoring
 * chrome that must never reach a reader.
 *
 * Keyed on the chip's OWN markers — the ⚡ label and/or its
 * `remove-conditional-block` control — NOT on `contenteditable="false"` alone.
 * That attribute is not unique to the chip: VideoEmbed (`data-node-type="video"`)
 * and other atom nodes also carry it, and compile never resolves them, so they
 * reach this pass intact. Keying on `contenteditable` deleted any video embedded
 * inside a conditional block — real content, gone silently. The negative
 * lookahead keeps the marker inside the SAME div, so a content node (no ⚡, no
 * remove control before its own `</div>`) is never matched. Both chip shapes are
 * covered: newer content has the × control, older content only the ⚡ label.
 */
function stripConditionalChrome(inner: string): string {
  return inner.replace(
    /<div\b[^>]*contenteditable="false"[^>]*>(?:(?!<\/div>)[\s\S])*?(?:remove-conditional-block|⚡)[\s\S]*?<\/div>/gi,
    ""
  );
}

/**
 * Keep conditional content whose tags intersect `activeTags`, strip the rest.
 * An empty/absent `activeTags` keeps everything (no audience selected).
 */
export function resolveConditionals(
  content: string,
  activeTags: string[] | undefined
): string {
  // "Keep all the content" and "leave the markup alone" are DIFFERENT things.
  // This used to return `content` untouched when no audience was selected, which
  // was invisible while compile output stayed inside the CMS — but published
  // pages then carried the raw conditional wrappers AND the editor's label chip
  // ("⚡ advanced ×") straight to the reader. The wrappers are always unwrapped;
  // only the keep/strip DECISION depends on activeTags.
  const keepAll = !activeTags || activeTags.length === 0;

  // Unreadable tags → keep the content. Failing open risks over-publishing, but
  // failing closed would silently delete authored content; parseTags now handles
  // the real markup, so this is a guard rather than a routine path.
  const kept = (tags: string[] | null) =>
    keepAll || !tags || tags.some((t) => activeTags!.includes(t));

  // Conditionals NEST (a gated block inside another gated block). Unwrapping the
  // outer one and returning its inner content verbatim left the inner wrapper —
  // and its editor chrome — in the output. Recurse: `inner` is strictly smaller
  // than `content`, so this terminates.
  const keepBlock = (tags: string[] | null, inner: string) =>
    kept(tags) ? resolveConditionals(stripConditionalChrome(inner), activeTags) : "";
  const keepInline = (tags: string[] | null, inner: string) =>
    kept(tags) ? resolveConditionals(inner, activeTags) : "";

  let out = replaceBalanced(
    content, "div", /<div\b[^>]*data-node-type="conditional"[^>]*>/gi, keepBlock
  );
  out = replaceBalanced(
    out, "span", /<span\b[^>]*data-mark-type="conditional"[^>]*>/gi, keepInline
  );
  return out;
}

/** Fully compile an article: snippets → variables → conditionals. */
export async function compileArticle(
  content: string,
  ref?: string,
  snippetCache?: Map<string, string>,
  activeTags?: string[]
): Promise<{ html: string; snippets: string[] }> {
  const variables = await getVariables(ref);

  // Snippets first — their bodies may themselves contain variables/conditionals.
  const { resolved: afterSnippets, snippets } = await resolveSnippets(content, ref, snippetCache);
  const afterVars = resolveVariables(afterSnippets, variables);
  const html = resolveConditionals(afterVars, activeTags);

  return { html, snippets };
}

/** Create a shared snippet cache for batch compilation. */
export function createSnippetCache(): Map<string, string> {
  return new Map();
}
