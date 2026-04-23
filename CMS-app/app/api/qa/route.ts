import { NextResponse } from "next/server";
import { getFile } from "@/lib/storage";
import type { Toc, QAIssue, TocSection } from "@/lib/types";
import { getSpellChecker } from "@/lib/spell-checker";

// ─── Text extraction ────────────────────────────────────────────────
/** Strip HTML tags and decode entities, returning plain text */
function extractText(html: string): string {
  return html
    // Remove HTML comments (including CMS snippet markers)
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Remove <style> and <script> blocks entirely
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    // Remove all HTML tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract individual words from text, filtering out non-word tokens */
function extractWords(text: string): string[] {
  // Split on whitespace and punctuation boundaries
  const tokens = text.split(/[\s,;:!?()\[\]{}"'<>=+*/\\|~`@#$%^&]+/);

  return tokens.filter((token) => {
    if (!token || token.length < 2) return false;
    // Skip pure numbers
    if (/^\d+$/.test(token)) return false;
    // Skip tokens with numbers mixed in (version numbers, IDs, etc.)
    if (/\d/.test(token) && /[a-zA-Z]/.test(token)) return false;
    // Skip paths, URLs, emails
    if (token.includes("/") || token.includes("@") || token.includes(".") && token.includes("/")) return false;
    // Skip camelCase / PascalCase (likely code identifiers)
    if (/^[a-z]+[A-Z]/.test(token)) return false;
    // Skip ALL_CAPS_WITH_UNDERSCORES (likely constants)
    if (/^[A-Z_]+$/.test(token) && token.includes("_")) return false;
    // Skip tokens that look like file extensions
    if (/^\.[a-z]+$/.test(token)) return false;
    return true;
  });
}

// ─── QA Route ───────────────────────────────────────────────────────
export async function GET() {
  const issues: QAIssue[] = [];

  try {
    const tocFile = await getFile("content/toc.json");
    const toc: Toc = JSON.parse(tocFile.content);

    // Collect all article files from TOC
    const tocFiles = new Set<string>();
    const allArticles: { file: string; title: string }[] = [];

    for (const cat of toc.categories) {
      const collectFromSections = (sections: TocSection[]) => {
        for (const sec of sections) {
          for (const art of sec.articles) {
            tocFiles.add(art.file);
            allArticles.push({ file: art.file, title: art.title });
          }
          if (sec.subsections) collectFromSections(sec.subsections);
        }
      };
      collectFromSections(cat.sections);
    }
    for (const art of toc.articles || []) {
      tocFiles.add(art.file);
      allArticles.push({ file: art.file, title: art.title });
    }

    // Initialize spell checker
    const spell = await getSpellChecker();

    // Check each article
    for (const article of allArticles) {
      try {
        const file = await getFile(`content/${article.file}`);
        const content = file.content;

        // Check for empty articles
        const bodyMatch = content.split("---").slice(2).join("---").trim();
        if (!bodyMatch || bodyMatch.length < 20) {
          issues.push({
            type: "empty-article",
            severity: "warning",
            file: article.file,
            message: `"${article.title}" has little or no content`,
          });
        }

        // Check for broken internal links
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let match;
        while ((match = linkRegex.exec(content)) !== null) {
          const href = match[2];
          // Skip external links and anchors
          if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) continue;
          // Check if it's a known slug
          const isKnown = allArticles.some(
            (a) => a.file.includes(href) || href.includes(a.title.toLowerCase().replace(/\s+/g, "-"))
          );
          if (!isKnown) {
            issues.push({
              type: "broken-link",
              severity: "error",
              file: article.file,
              message: `Broken link in "${article.title}"`,
              detail: `Link to "${href}" — target not found in TOC`,
            });
          }
        }

        // Check for missing images
        const imgRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
        while ((match = imgRegex.exec(content)) !== null) {
          const src = match[1];
          if (src.startsWith("http")) continue;
          // Try to check if image file exists
          try {
            await getFile(`content/${src.replace(/^\//, "")}`);
          } catch {
            issues.push({
              type: "missing-image",
              severity: "error",
              file: article.file,
              message: `Missing image in "${article.title}"`,
              detail: `Image "${src}" not found`,
            });
          }
        }

        // Check for stale articles (>6 months)
        const dateMatch = content.match(/lastModified:\s*(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          const lastMod = new Date(dateMatch[1]);
          const sixMonthsAgo = new Date();
          sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
          if (lastMod < sixMonthsAgo) {
            issues.push({
              type: "stale-article",
              severity: "info",
              file: article.file,
              message: `"${article.title}" hasn't been updated since ${dateMatch[1]}`,
            });
          }
        }

        // ─── Spell check ───────────────────────────────────────
        const plainText = extractText(content);
        const words = extractWords(plainText);
        const misspelled: Map<string, number> = new Map(); // word → count

        for (const word of words) {
          // Try the word as-is, then lowercased
          if (spell.correct(word)) continue;
          if (spell.correct(word.toLowerCase())) continue;
          // Skip ALL CAPS words (likely acronyms)
          if (word === word.toUpperCase() && word.length <= 6) continue;
          // Skip words ending in 's that are possessives of valid words
          if (word.endsWith("'s") && spell.correct(word.slice(0, -2))) continue;

          const key = word.toLowerCase();
          misspelled.set(key, (misspelled.get(key) || 0) + 1);
        }

        if (misspelled.size > 0) {
          // Group misspellings: show up to 10 per article
          const entries = [...misspelled.entries()]
            .sort((a, b) => b[1] - a[1]) // most frequent first
            .slice(0, 10);

          const wordList = entries
            .map(([word, count]) => {
              const suggestions = spell.suggest(word).slice(0, 3);
              const sugText = suggestions.length > 0 ? ` → ${suggestions.join(", ")}` : "";
              return `"${word}"${count > 1 ? ` (×${count})` : ""}${sugText}`;
            })
            .join("; ");

          const remaining = misspelled.size - entries.length;
          const detail = wordList + (remaining > 0 ? `; +${remaining} more` : "");

          issues.push({
            type: "spelling",
            severity: "warning",
            file: article.file,
            message: `${misspelled.size} potential spelling issue${misspelled.size !== 1 ? "s" : ""} in "${article.title}"`,
            detail,
          });
        }
      } catch {
        issues.push({
          type: "broken-link",
          severity: "error",
          file: article.file,
          message: `"${article.title}" — file not found on disk`,
          detail: `Expected at content/${article.file}`,
        });
      }
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "QA scan failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    issues,
    summary: {
      total: issues.length,
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      info: issues.filter((i) => i.severity === "info").length,
    },
  });
}
