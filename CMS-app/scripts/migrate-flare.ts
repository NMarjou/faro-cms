/**
 * Migrate MadCap Flare HTML output to MDX content files.
 *
 * Usage:
 *   npx tsx scripts/migrate-flare.ts <path-to-flare-output>
 *
 * This script:
 * 1. Parses the Flare TOC to get the navigation hierarchy
 * 2. Converts each .htm topic file to MDX
 * 3. Generates content/toc.json
 * 4. Extracts variables into content/variables.json
 * 5. Creates the content directory structure
 */

import * as fs from "fs";
import * as path from "path";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Custom rules for Flare-specific HTML
turndown.addRule("messageBoxBlue", {
  filter: (node) =>
    node.nodeName === "DIV" && node.classList?.contains("message-blue"),
  replacement: (content) =>
    `\n<MessageBox type="info">\n\n${content.trim()}\n\n</MessageBox>\n`,
});

turndown.addRule("messageBoxGreen", {
  filter: (node) =>
    node.nodeName === "DIV" && node.classList?.contains("message-green"),
  replacement: (content) =>
    `\n<MessageBox type="tip">\n\n${content.trim()}\n\n</MessageBox>\n`,
});

turndown.addRule("mcVariable", {
  filter: (node) =>
    node.nodeName === "SPAN" && node.classList?.contains("mc-variable"),
  replacement: (_content, node) => {
    const varAttr =
      (node as Element).getAttribute("data-mc-variable") || "";
    // Extract variable name from Flare format: "General.ProductName" → "productName"
    const parts = varAttr.split(".");
    const name = parts.length > 1 ? camelCase(parts.slice(1).join("-")) : camelCase(varAttr);
    collectedVariables.add(JSON.stringify({ flareKey: varAttr, name, value: (node as Element).textContent || "" }));
    return `<Var name="${name}" />`;
  },
});

turndown.addRule("conditionalContent", {
  filter: (node) =>
    node.nodeName === "DIV" &&
    (node as Element).getAttribute("data-mc-conditions") !== null,
  replacement: (content, node) => {
    const conditions =
      (node as Element).getAttribute("data-mc-conditions") || "";
    const tags = conditions
      .split(",")
      .map((c: string) => c.trim().split(".").pop() || c.trim())
      .filter(Boolean);
    return `\n<Conditional tags={${JSON.stringify(tags)}}>\n\n${content.trim()}\n\n</Conditional>\n`;
  },
});

// Strip Flare-specific elements
turndown.addRule("stripScripts", {
  filter: ["script", "link"],
  replacement: () => "",
});

turndown.addRule("stripNav", {
  filter: (node) =>
    node.nodeName === "NAV" ||
    (node.nodeName === "DIV" &&
      (node.classList?.contains("breadcrumbs") ||
        node.classList?.contains("nocontent"))),
  replacement: () => "",
});

// Track collected variables
const collectedVariables = new Set<string>();

// ── TOC Parsing ──

interface TocNode {
  i?: number;
  c?: number;
  n?: TocNode[];
}

interface TocChunkEntry {
  path: string;
  title: string;
}

function parseTocRoot(flareDir: string): { tree: TocNode; numchunks: number } {
  const tocDir = path.join(flareDir, "Data", "Tocs");
  const tocFiles = fs.readdirSync(tocDir).filter(
    (f) => f.endsWith(".js") && !f.includes("Chunk")
  );

  if (tocFiles.length === 0) throw new Error("No TOC root file found");

  const content = fs.readFileSync(path.join(tocDir, tocFiles[0]), "utf-8");
  const match = content.match(/define\((\{[\s\S]*\})\)/);
  if (!match) throw new Error("Could not parse TOC root");

  // eslint-disable-next-line no-eval
  const data = eval(`(${match[1]})`);
  return { tree: data.tree || data, numchunks: data.numchunks || 0 };
}

function parseTocChunks(
  flareDir: string,
  numchunks: number
): Map<number, TocChunkEntry> {
  const tocDir = path.join(flareDir, "Data", "Tocs");
  const entries = new Map<number, TocChunkEntry>();

  for (let i = 0; i <= numchunks; i++) {
    const chunkFiles = fs
      .readdirSync(tocDir)
      .filter((f) => f.includes(`Chunk${i}.js`));

    for (const chunkFile of chunkFiles) {
      const content = fs.readFileSync(
        path.join(tocDir, chunkFile),
        "utf-8"
      );
      const match = content.match(/define\((\{[\s\S]*\})\)/);
      if (!match) continue;

      // eslint-disable-next-line no-eval
      const data = eval(`(${match[1]})`);
      if (data.t && data.i) {
        for (let j = 0; j < data.i.length; j++) {
          entries.set(data.i[j], {
            path: data.p?.[j] || "",
            title: data.t[j] || "",
          });
        }
      }
    }
  }

  return entries;
}

// ── Build content structure ──

interface Category {
  name: string;
  slug: string;
  description: string;
  sections: Section[];
}

interface Section {
  name: string;
  slug: string;
  articles: Article[];
}

interface Article {
  title: string;
  file: string;
  slug: string;
  sourceFile: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildStructure(
  tree: TocNode,
  chunks: Map<number, TocChunkEntry>
): Category[] {
  const categories: Category[] = [];
  const topNodes = tree.n || [];

  for (const catNode of topNodes) {
    const catEntry = chunks.get(catNode.i || 0);
    if (!catEntry) continue;

    const category: Category = {
      name: catEntry.title,
      slug: slugify(catEntry.title),
      description: "",
      sections: [],
    };

    const children = catNode.n || [];
    for (const child of children) {
      const entry = chunks.get(child.i || 0);
      if (!entry) continue;

      if (child.c === 1 && child.n) {
        // This is a section
        const section: Section = {
          name: entry.title,
          slug: slugify(entry.title),
          articles: [],
        };

        for (const articleNode of child.n || []) {
          const artEntry = chunks.get(articleNode.i || 0);
          if (!artEntry) continue;
          const artSlug = slugify(artEntry.title);
          section.articles.push({
            title: artEntry.title,
            file: `${category.slug}/${section.slug}/${artSlug}.mdx`,
            slug: artSlug,
            sourceFile: artEntry.path,
          });
        }

        category.sections.push(section);
      } else {
        // Direct article under category — put in "General" section
        let generalSection = category.sections.find(
          (s) => s.slug === "general"
        );
        if (!generalSection) {
          generalSection = { name: "General", slug: "general", articles: [] };
          category.sections.push(generalSection);
        }
        const artSlug = slugify(entry.title);
        generalSection.articles.push({
          title: entry.title,
          file: `${category.slug}/general/${artSlug}.mdx`,
          slug: artSlug,
          sourceFile: entry.path,
        });
      }
    }

    categories.push(category);
  }

  return categories;
}

// ── HTML to MDX conversion ──

function convertHtmlToMdx(
  htmlContent: string,
  title: string,
  category: string,
  section: string,
  slug: string
): string {
  // Strip everything outside <body> content
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : htmlContent;

  // Convert HTML to Markdown
  let mdContent = turndown.turndown(body);

  // Clean up excessive whitespace
  mdContent = mdContent.replace(/\n{3,}/g, "\n\n").trim();

  // Fix image paths
  mdContent = mdContent.replace(
    /!\[([^\]]*)\]\((?:\.\.\/)*resources\/images\//gi,
    "![$1](/images/"
  );

  // Build frontmatter
  const frontmatter = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `slug: ${slug}`,
    `category: ${category}`,
    `section: ${section}`,
    `tags: []`,
    `conditions: []`,
    `lastModified: ${new Date().toISOString().split("T")[0]}`,
    `author: migrated-from-flare`,
    "---",
  ].join("\n");

  return `${frontmatter}\n\n${mdContent}\n`;
}

// ── Main ──

async function main() {
  const flareDir = process.argv[2];
  if (!flareDir) {
    console.error("Usage: npx tsx scripts/migrate-flare.ts <flare-output-dir>");
    process.exit(1);
  }

  if (!fs.existsSync(flareDir)) {
    console.error(`Directory not found: ${flareDir}`);
    process.exit(1);
  }

  const outputDir = path.resolve(__dirname, "..", "..", "content");

  console.log(`Flare source: ${flareDir}`);
  console.log(`Output directory: ${outputDir}`);

  // 1. Parse TOC
  console.log("\nParsing TOC...");
  const { tree, numchunks } = parseTocRoot(flareDir);
  const chunks = parseTocChunks(flareDir, numchunks);
  console.log(`  Found ${chunks.size} TOC entries across ${numchunks + 1} chunks`);

  // 2. Build structure
  console.log("\nBuilding content structure...");
  const categories = buildStructure(tree, chunks);

  let totalArticles = 0;
  for (const cat of categories) {
    console.log(`  ${cat.name}: ${cat.sections.length} sections`);
    for (const sec of cat.sections) {
      totalArticles += sec.articles.length;
    }
  }
  console.log(`  Total articles to migrate: ${totalArticles}`);

  // 3. Create directories and convert articles
  console.log("\nConverting articles...");
  let converted = 0;
  let failed = 0;

  for (const cat of categories) {
    for (const sec of cat.sections) {
      const dir = path.join(outputDir, cat.slug, sec.slug);
      fs.mkdirSync(dir, { recursive: true });

      for (const article of sec.articles) {
        try {
          // Find source file
          const sourcePaths = [
            path.join(flareDir, "Content", article.sourceFile),
            path.join(flareDir, "content", article.sourceFile),
            path.join(flareDir, article.sourceFile),
          ];

          let htmlContent = "";
          for (const sp of sourcePaths) {
            if (fs.existsSync(sp)) {
              htmlContent = fs.readFileSync(sp, "utf-8");
              break;
            }
          }

          if (!htmlContent) {
            console.warn(`  SKIP: Source not found for ${article.sourceFile}`);
            failed++;
            continue;
          }

          const mdx = convertHtmlToMdx(
            htmlContent,
            article.title,
            cat.slug,
            sec.slug,
            article.slug
          );

          const outFile = path.join(outputDir, article.file);
          fs.writeFileSync(outFile, mdx, "utf-8");
          converted++;

          if (converted % 50 === 0) {
            console.log(`  Converted ${converted}/${totalArticles}...`);
          }
        } catch (err) {
          console.warn(
            `  FAIL: ${article.title}: ${err instanceof Error ? err.message : err}`
          );
          failed++;
        }
      }
    }
  }

  console.log(`\n  Converted: ${converted}`);
  console.log(`  Failed: ${failed}`);

  // 4. Generate toc.json
  console.log("\nGenerating toc.json...");
  const toc = {
    categories: categories.map((cat) => ({
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      sections: cat.sections.map((sec) => ({
        name: sec.name,
        slug: sec.slug,
        articles: sec.articles.map((art) => ({
          title: art.title,
          file: art.file,
          slug: art.slug,
        })),
      })),
    })),
  };

  fs.writeFileSync(
    path.join(outputDir, "toc.json"),
    JSON.stringify(toc, null, 2),
    "utf-8"
  );

  // 5. Extract variables
  console.log("Generating variables.json...");
  const variables: Record<string, string> = {};
  for (const entry of collectedVariables) {
    const parsed = JSON.parse(entry);
    variables[parsed.name] = parsed.value;
  }

  fs.writeFileSync(
    path.join(outputDir, "variables.json"),
    JSON.stringify(variables, null, 2),
    "utf-8"
  );
  console.log(`  Extracted ${Object.keys(variables).length} variables`);

  // 6. Create conditions.json
  fs.writeFileSync(
    path.join(outputDir, "conditions.json"),
    JSON.stringify({ tags: [] }, null, 2),
    "utf-8"
  );

  // 7. Create snippets directory
  fs.mkdirSync(path.join(outputDir, "snippets"), { recursive: true });

  console.log("\nMigration complete!");
  console.log(`Output: ${outputDir}`);
}

function camelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^./, (c) => c.toLowerCase());
}

main().catch(console.error);
