import { NextRequest, NextResponse } from "next/server";
import { getSpellChecker } from "@/lib/spell-checker";

export interface SpellIssue {
  word: string;
  suggestions: string[];
  /** Character offset in the plain-text version */
  offset: number;
  /** Number of occurrences */
  count: number;
}

/** Strip HTML tags and decode entities, returning plain text */
function extractText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenise the plain text, returning word + character position pairs */
function tokenize(text: string): { word: string; index: number }[] {
  const tokens: { word: string; index: number }[] = [];
  const re = /[a-zA-Z'\u2019]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ word: m[0], index: m.index });
  }
  return tokens;
}

function shouldSkip(word: string): boolean {
  if (word.length < 2) return true;
  // Pure numbers handled by regex already; double-check
  if (/^\d+$/.test(word)) return true;
  // ALL CAPS ≤ 6 chars → likely acronym
  if (word === word.toUpperCase() && word.length <= 6) return true;
  // camelCase / PascalCase
  if (/^[a-z]+[A-Z]/.test(word)) return true;
  return false;
}

/** POST — spell-check arbitrary HTML content */
export async function POST(request: NextRequest) {
  try {
    const { content } = (await request.json()) as { content: string };
    if (!content) {
      return NextResponse.json({ issues: [] });
    }

    const spell = await getSpellChecker();
    const plainText = extractText(content);
    const tokens = tokenize(plainText);

    // Deduplicate: group by lowercased word
    const seen = new Map<string, SpellIssue>();

    for (const { word, index } of tokens) {
      if (shouldSkip(word)) continue;
      if (spell.correct(word)) continue;
      if (spell.correct(word.toLowerCase())) continue;
      // Possessives
      if ((word.endsWith("'s") || word.endsWith("\u2019s")) && spell.correct(word.slice(0, -2))) continue;

      const key = word.toLowerCase();
      const existing = seen.get(key);
      if (existing) {
        existing.count++;
      } else {
        seen.set(key, {
          word,
          suggestions: spell.suggest(word).slice(0, 5),
          offset: index,
          count: 1,
        });
      }
    }

    const issues = [...seen.values()].sort((a, b) => a.offset - b.offset);

    return NextResponse.json({ issues, totalWords: tokens.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Spell check failed" },
      { status: 500 }
    );
  }
}
