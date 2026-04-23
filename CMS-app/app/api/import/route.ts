import { NextRequest, NextResponse } from "next/server";
import { putFile, getFile } from "@/lib/storage";
import type { Toc, TocCategory, TocSection, TocArticle, VariableSetsData } from "@/lib/types";
import mammoth from "mammoth";
import { marked } from "marked";

// ─── Madcap Flare Variable Parser (.flvar) ──────────────────────────
function parseFlareVariables(xml: string): { setName: string; variables: Record<string, string> } {
  const variables: Record<string, string> = {};

  // Extract set name from filename or CatapultVariableSet
  const varRegex = /<Variable[\s\S]*?Name="([^"]*)"[\s\S]*?>([\s\S]*?)<\/Variable>/g;
  let match;
  while ((match = varRegex.exec(xml)) !== null) {
    const name = match[1].trim();
    const value = match[2].trim();
    if (name && value) {
      variables[name] = value;
    }
  }

  return { setName: "Imported", variables };
}

// ─── Madcap Flare TOC Parser (.fltoc) ───────────────────────────────
interface FlareTocEntry {
  title: string;
  link: string;
  children: FlareTocEntry[];
}

function parseFlareToc(xml: string): FlareTocEntry[] {
  const entries: FlareTocEntry[] = [];
  parseTocEntries(xml, entries);
  return entries;
}

function parseTocEntries(xml: string, entries: FlareTocEntry[]): void {
  // Match top-level TocEntry elements — use a recursive state machine
  const tocRegex = /<TocEntry([\s\S]*?)(?:\/>|>([\s\S]*?)<\/TocEntry>)/g;
  let match;

  // We need a proper recursive parser since regex can't handle nested tags
  // Use a simple state-based approach
  const parsed = parseNestedTocEntries(xml);
  entries.push(...parsed);
}

function parseNestedTocEntries(xml: string): FlareTocEntry[] {
  const results: FlareTocEntry[] = [];
  let pos = 0;

  while (pos < xml.length) {
    const openStart = xml.indexOf("<TocEntry", pos);
    if (openStart === -1) break;

    // Find the end of the opening tag attributes
    const tagEnd = xml.indexOf(">", openStart);
    if (tagEnd === -1) break;

    const tagContent = xml.substring(openStart, tagEnd + 1);

    // Extract Link attribute
    const linkMatch = tagContent.match(/Link="([^"]*)"/);
    const titleMatch = tagContent.match(/Title="([^"]*)"/);
    const link = linkMatch ? linkMatch[1] : "";
    const title = titleMatch ? titleMatch[1] : "";

    // Check if self-closing
    if (tagContent.endsWith("/>")) {
      results.push({ title, link, children: [] });
      pos = tagEnd + 1;
      continue;
    }

    // Find matching closing tag (handle nesting)
    let depth = 1;
    let searchPos = tagEnd + 1;
    while (depth > 0 && searchPos < xml.length) {
      const nextOpen = xml.indexOf("<TocEntry", searchPos);
      const nextClose = xml.indexOf("</TocEntry>", searchPos);

      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        // Check if self-closing
        const selfCloseCheck = xml.indexOf(">", nextOpen);
        if (selfCloseCheck !== -1 && xml.substring(nextOpen, selfCloseCheck + 1).endsWith("/>")) {
          searchPos = selfCloseCheck + 1;
        } else {
          depth++;
          searchPos = selfCloseCheck + 1;
        }
      } else {
        depth--;
        if (depth === 0) {
          const innerContent = xml.substring(tagEnd + 1, nextClose);
          const children = parseNestedTocEntries(innerContent);
          results.push({ title, link, children });
          pos = nextClose + "</TocEntry>".length;
        } else {
          searchPos = nextClose + "</TocEntry>".length;
        }
      }
    }

    if (depth > 0) {
      // Malformed XML, skip
      results.push({ title, link, children: [] });
      pos = tagEnd + 1;
    }
  }

  return results;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleFromPath(linkPath: string): string {
  // Extract filename, remove extension, convert hyphens to spaces
  const parts = linkPath.split("/");
  const filename = parts[parts.length - 1] || "";
  return filename
    .replace(/\.htm[l]?$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function convertFlareTocToCms(flareEntries: FlareTocEntry[]): Toc {
  const categories: TocCategory[] = [];

  for (const catEntry of flareEntries) {
    const catName = titleFromPath(catEntry.link);
    const catSlug = slugify(catName);
    const sections: TocSection[] = [];

    for (const secEntry of catEntry.children) {
      const secName = titleFromPath(secEntry.link);
      const secSlug = slugify(secName);
      const articles: TocArticle[] = [];

      for (const artEntry of secEntry.children) {
        const artTitle = titleFromPath(artEntry.link);
        const artSlug = slugify(artTitle);
        // Convert Flare path to CMS path
        const filePath = artEntry.link
          .replace(/^\/Content\//, "")
          .replace(/\.htm$/, ".html");

        articles.push({
          title: artTitle,
          slug: artSlug,
          file: filePath.toLowerCase(),
          format: "html",
          tags: [],
          conditions: [],
        });

        // Recurse into subsection articles (4th level becomes more articles)
        if (artEntry.children.length > 0) {
          for (const subArt of artEntry.children) {
            const subTitle = titleFromPath(subArt.link);
            const subSlug = slugify(subTitle);
            const subFile = subArt.link
              .replace(/^\/Content\//, "")
              .replace(/\.htm$/, ".html");
            articles.push({
              title: subTitle,
              slug: subSlug,
              file: subFile.toLowerCase(),
              format: "html",
              tags: [],
              conditions: [],
            });
          }
        }
      }

      sections.push({
        name: secName,
        slug: secSlug,
        articles,
      });
    }

    categories.push({
      name: catName,
      slug: catSlug,
      description: "",
      sections,
    });
  }

  return { categories };
}

// ─── Madcap Flare Article Parser (.htm) ─────────────────────────────
function parseFlareArticle(html: string, filename: string): { title: string; content: string } {
  // Extract title from <h1>
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1Match
    ? h1Match[1].replace(/<[^>]+>/g, "").trim()
    : titleFromPath(filename);

  // Extract body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let content = bodyMatch ? bodyMatch[1].trim() : html;

  // Convert MadCap:snippetBlock to CMS snippet references
  content = content.replace(
    /<MadCap:snippetBlock\s+src="([^"]*)"[^/]*\/>/g,
    (_match, src: string) => {
      const snippetName = extractSnippetName(src);
      return `<!--snippet:${snippetName}-->`;
    }
  );

  // Convert MadCap:snippetText to CMS snippet references
  content = content.replace(
    /<MadCap:snippetText\s+src="([^"]*)"[^/]*\/>/g,
    (_match, src: string) => {
      const snippetName = extractSnippetName(src);
      return `<!--snippet:${snippetName}-->`;
    }
  );

  // Convert MadCap:variable to CMS variable spans
  content = content.replace(
    /<MadCap:variable\s+name="([^"]*)"[^/]*\/>/g,
    (_match, name: string) => {
      // Flare uses "set.variable" format — extract just the variable name
      const varName = name.includes(".") ? name.split(".").pop()! : name;
      return `<span data-variable="${varName}" data-node-type="variable">{${varName}}</span>`;
    }
  );

  // Convert MadCap:conditionalText / conditions
  content = content.replace(
    /<MadCap:conditionalText\s+MadCap:conditions="([^"]*)">([\s\S]*?)<\/MadCap:conditionalText>/g,
    (_match, conditions: string, inner: string) => {
      const tags = conditions.split(",").map((c) => c.trim().split(".").pop() || c.trim());
      return `<span data-mark-type="conditional" data-tags='${JSON.stringify(tags)}'>${inner}</span>`;
    }
  );

  // Best-effort link rewriting: convert Flare relative paths to CMS slugs
  content = content.replace(
    /(<a\s+[^>]*href=")([^"]*)([""][^>]*>)/gi,
    (_match, prefix: string, href: string, suffix: string) => {
      // Only rewrite internal/relative links
      if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#") || href.startsWith("tel:")) {
        return prefix + href + suffix;
      }
      // Extract the filename stem and convert to a slug
      const anchor = href.includes("#") ? "#" + href.split("#").pop() : "";
      const pathPart = href.replace(/#.*$/, "").replace(/\?.*$/, "");
      const parts = pathPart.split("/");
      const filename = parts[parts.length - 1] || "";
      const stem = filename.replace(/\.[^.]+$/, "");
      if (!stem) return prefix + href + suffix;
      const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return prefix + slug + ".html" + anchor + suffix;
    }
  );

  // Remove MadCap XML namespace declarations
  content = content.replace(/\s*xmlns:MadCap="[^"]*"/g, "");

  // Clean up empty paragraphs wrapping divs
  content = content.replace(/<p>\s*(<div[\s\S]*?<\/div>)\s*<\/p>/g, "$1");

  return { title, content };
}

function extractSnippetName(src: string): string {
  // Extract filename without extension from paths like "../../Resources/Snippets/foo/bar.flsnp"
  const parts = src.split("/");
  const filename = parts[parts.length - 1] || "";
  return filename.replace(/\.flsnp$/, "");
}

// ─── Markdown Article Parser (.md) ──────────────────────────────────
function parseMarkdownArticle(md: string, filename: string): { title: string; content: string } {
  // Extract title from first # heading or frontmatter
  let title = titleFromPath(filename);
  let body = md;

  // Strip YAML frontmatter
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    const frontmatter = fmMatch[1];
    body = fmMatch[2];
    const titleMatch = frontmatter.match(/title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) title = titleMatch[1];
  }

  // Extract title from first # heading if not found in frontmatter
  const h1Match = body.match(/^#\s+(.+)$/m);
  if (h1Match && title === titleFromPath(filename)) {
    title = h1Match[1].trim();
  }

  // Convert markdown to HTML
  const html = marked.parse(body, { async: false }) as string;

  return { title, content: html };
}

// ─── DOCX Article Parser (.docx) ────────────────────────────────────
async function parseDocxArticle(base64: string, filename: string): Promise<{ title: string; content: string }> {
  const buffer = Buffer.from(base64, "base64");
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value;

  // Extract title from first <h1> or <p><strong>
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1Match
    ? h1Match[1].replace(/<[^>]+>/g, "").trim()
    : titleFromPath(filename);

  return { title, content: html };
}

// ─── Generic article parser — detects format by extension ───────────
async function parseArticle(file: { name: string; content: string }): Promise<{ title: string; content: string }> {
  const ext = file.name.toLowerCase().split(".").pop() || "";

  switch (ext) {
    case "docx":
      return parseDocxArticle(file.content, file.name);
    case "md":
    case "markdown":
      return parseMarkdownArticle(file.content, file.name);
    case "htm":
    case "html":
    default:
      return parseFlareArticle(file.content, file.name);
  }
}

// ─── Madcap Flare Snippet Parser (.flsnp) ───────────────────────────
function parseFlareSnippet(html: string, filename: string): { name: string; content: string } {
  const name = filename.replace(/\.flsnp$/, "");

  // Extract body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let content = bodyMatch ? bodyMatch[1].trim() : html;

  // Convert MadCap:variable references
  content = content.replace(
    /<MadCap:variable\s+name="([^"]*)"[^/]*\/>/g,
    (_match, varName: string) => {
      const name = varName.includes(".") ? varName.split(".").pop()! : varName;
      return `<span data-variable="${name}" data-node-type="variable">{${name}}</span>`;
    }
  );

  // Convert nested snippet references
  content = content.replace(
    /<MadCap:snippetBlock\s+src="([^"]*)"[^/]*\/>/g,
    (_match, src: string) => {
      const snippetName = extractSnippetName(src);
      return `<!--snippet:${snippetName}-->`;
    }
  );
  content = content.replace(
    /<MadCap:snippetText\s+src="([^"]*)"[^/]*\/>/g,
    (_match, src: string) => {
      const snippetName = extractSnippetName(src);
      return `<!--snippet:${snippetName}-->`;
    }
  );

  // Remove namespace declarations
  content = content.replace(/\s*xmlns:MadCap="[^"]*"/g, "");

  return { name, content };
}

// ─── API Routes ─────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, files, setName, merge } = body;

    switch (type) {
      case "preview-variables": {
        // Parse and return preview without saving
        const results: { setName: string; variables: Record<string, string> }[] = [];
        for (const file of files as { name: string; content: string }[]) {
          const parsed = parseFlareVariables(file.content);
          parsed.setName = setName || file.name.replace(/\.flvar$/, "");
          results.push(parsed);
        }
        return NextResponse.json({ results });
      }

      case "import-variables": {
        // Parse and save variables
        const allVars: Record<string, string> = {};
        let importSetName = setName || "Imported";

        for (const file of files as { name: string; content: string }[]) {
          const parsed = parseFlareVariables(file.content);
          if (!setName) importSetName = file.name.replace(/\.flvar$/, "");
          Object.assign(allVars, parsed.variables);
        }

        // Load existing variables and add as a new set
        let existing: VariableSetsData = { sets: [] };
        try {
          const file = await getFile("content/variables.json");
          existing = JSON.parse(file.content);
          if (!existing.sets) existing = { sets: [] };
        } catch { /* first time */ }

        if (merge) {
          // Merge into existing set with the same name, or create new
          const existingSet = existing.sets.find((s) => s.slug === slugify(importSetName));
          if (existingSet) {
            Object.assign(existingSet.variables, allVars);
          } else {
            existing.sets.push({ name: importSetName, slug: slugify(importSetName), variables: allVars });
          }
        } else {
          // Replace set with same name or add new
          const idx = existing.sets.findIndex((s) => s.slug === slugify(importSetName));
          if (idx >= 0) {
            existing.sets[idx] = { name: importSetName, slug: slugify(importSetName), variables: allVars };
          } else {
            existing.sets.push({ name: importSetName, slug: slugify(importSetName), variables: allVars });
          }
        }

        await putFile("content/variables.json", JSON.stringify(existing, null, 2), `Import variables from Madcap Flare: ${importSetName}`);
        return NextResponse.json({ success: true, count: Object.keys(allVars).length, setName: importSetName });
      }

      case "preview-toc": {
        const file = (files as { name: string; content: string }[])[0];
        const flareEntries = parseFlareToc(file.content);
        const toc = convertFlareTocToCms(flareEntries);
        return NextResponse.json({ toc });
      }

      case "import-toc": {
        const file = (files as { name: string; content: string }[])[0];
        const flareEntries = parseFlareToc(file.content);
        const toc = convertFlareTocToCms(flareEntries);

        if (merge) {
          // Merge into existing TOC
          try {
            const existing = await getFile("content/toc.json");
            const existingToc: Toc = JSON.parse(existing.content);
            // Add new categories that don't exist yet
            for (const cat of toc.categories) {
              const existingCat = existingToc.categories.find((c) => c.slug === cat.slug);
              if (!existingCat) {
                existingToc.categories.push(cat);
              } else {
                // Merge sections
                for (const sec of cat.sections) {
                  const existingSec = existingCat.sections.find((s) => s.slug === sec.slug);
                  if (!existingSec) {
                    existingCat.sections.push(sec);
                  } else {
                    // Add articles that don't exist
                    for (const art of sec.articles) {
                      if (!existingSec.articles.find((a) => a.slug === art.slug)) {
                        existingSec.articles.push(art);
                      }
                    }
                  }
                }
              }
            }
            await putFile("content/toc.json", JSON.stringify(existingToc, null, 2), "Import TOC from Madcap Flare (merged)");
            return NextResponse.json({ success: true, toc: existingToc });
          } catch {
            // No existing TOC, just save the new one
            await putFile("content/toc.json", JSON.stringify(toc, null, 2), "Import TOC from Madcap Flare");
            return NextResponse.json({ success: true, toc });
          }
        }

        await putFile("content/toc.json", JSON.stringify(toc, null, 2), "Import TOC from Madcap Flare");
        return NextResponse.json({ success: true, toc });
      }

      case "preview-articles": {
        const results: { filename: string; title: string; content: string; path: string }[] = [];
        for (const file of files as { name: string; content: string }[]) {
          const parsed = await parseArticle(file);
          const slug = slugify(parsed.title);
          results.push({
            filename: file.name,
            title: parsed.title,
            content: parsed.content,
            path: `content/${slug}.html`,
          });
        }
        return NextResponse.json({ results });
      }

      case "import-articles": {
        const targetFolder = body.folder || "";
        const results: { title: string; path: string }[] = [];

        for (const file of files as { name: string; content: string }[]) {
          const parsed = await parseArticle(file);
          const slug = slugify(parsed.title);
          const path = targetFolder ? `${targetFolder}/${slug}.html` : `${slug}.html`;

          await putFile(
            `content/${path}`,
            parsed.content,
            `Import article: ${parsed.title}`
          );
          results.push({ title: parsed.title, path });
        }

        return NextResponse.json({ success: true, results });
      }

      case "preview-snippets": {
        const results: { filename: string; name: string; content: string }[] = [];
        for (const file of files as { name: string; content: string }[]) {
          const parsed = parseFlareSnippet(file.content, file.name);
          results.push({
            filename: file.name,
            name: parsed.name,
            content: parsed.content,
          });
        }
        return NextResponse.json({ results });
      }

      case "import-snippets": {
        const results: { name: string; path: string }[] = [];

        for (const file of files as { name: string; content: string }[]) {
          const parsed = parseFlareSnippet(file.content, file.name);
          const path = `snippets/${parsed.name}.html`;

          // Wrap content with snippet name comment
          const content = `<!--name:${parsed.name}-->\n${parsed.content}`;

          await putFile(
            `content/${path}`,
            content,
            `Import snippet: ${parsed.name}`
          );
          results.push({ name: parsed.name, path });
        }

        return NextResponse.json({ success: true, results });
      }

      case "preview-images": {
        const results: { filename: string; size: number; path: string }[] = [];
        const targetFolder = body.folder || "";
        for (const file of files as { name: string; content: string; size?: number }[]) {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
          const imgPath = targetFolder ? `images/${targetFolder}/${safeName}` : `images/${safeName}`;
          // content is base64, calculate approximate original size
          const size = file.size || Math.round((file.content.length * 3) / 4);
          results.push({ filename: file.name, size, path: imgPath });
        }
        return NextResponse.json({ results });
      }

      case "import-images": {
        const fs = await import("fs");
        const nodePath = await import("path");
        const CONTENT_ROOT = nodePath.resolve(process.cwd(), "..", "CMS-content");
        const isLocal = !process.env.GITHUB_TOKEN;
        const targetFolder = body.folder || "";
        const results: { name: string; path: string }[] = [];

        for (const file of files as { name: string; content: string }[]) {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
          const imgPath = targetFolder ? `images/${targetFolder}/${safeName}` : `images/${safeName}`;
          const buffer = Buffer.from(file.content, "base64");

          if (isLocal) {
            const dir = nodePath.dirname(nodePath.join(CONTENT_ROOT, imgPath));
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(nodePath.join(CONTENT_ROOT, imgPath), buffer);
          } else {
            await putFile(
              `content/${imgPath}`,
              file.content, // already base64
              `Import image: ${safeName}`
            );
          }

          results.push({ name: safeName, path: imgPath });
        }

        return NextResponse.json({ success: true, results });
      }

      default:
        return NextResponse.json({ error: `Unknown import type: ${type}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
