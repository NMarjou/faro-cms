import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile } from "@/lib/storage";
import { resetSpellChecker } from "@/lib/spell-checker";

const DICT_PATH = "content/custom-dictionary.json";

interface CustomDictionary {
  words: string[];
}

async function loadDictionary(): Promise<CustomDictionary> {
  try {
    const file = await getFile(DICT_PATH);
    const parsed = JSON.parse(file.content);
    return { words: Array.isArray(parsed.words) ? parsed.words : [] };
  } catch {
    return { words: [] };
  }
}

/** GET — return the custom dictionary */
export async function GET() {
  const dict = await loadDictionary();
  return NextResponse.json(dict);
}

/** POST — add words to the custom dictionary */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { words } = body as { words: string[] };

    if (!words || !Array.isArray(words) || words.length === 0) {
      return NextResponse.json({ error: "words array is required" }, { status: 400 });
    }

    const dict = await loadDictionary();
    const existing = new Set(dict.words.map((w) => w.toLowerCase()));
    let added = 0;

    for (const word of words) {
      const trimmed = word.trim();
      if (trimmed && !existing.has(trimmed.toLowerCase())) {
        dict.words.push(trimmed);
        existing.add(trimmed.toLowerCase());
        added++;
      }
    }

    // Sort alphabetically
    dict.words.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    await putFile(DICT_PATH, JSON.stringify(dict, null, 2), `Add ${added} word${added !== 1 ? "s" : ""} to custom dictionary`);
    resetSpellChecker(); // invalidate so next QA scan picks up new words

    return NextResponse.json({ success: true, added, total: dict.words.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update dictionary" },
      { status: 500 }
    );
  }
}

/** DELETE — remove words from the custom dictionary */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { words } = body as { words: string[] };

    if (!words || !Array.isArray(words) || words.length === 0) {
      return NextResponse.json({ error: "words array is required" }, { status: 400 });
    }

    const dict = await loadDictionary();
    const toRemove = new Set(words.map((w) => w.toLowerCase()));
    const before = dict.words.length;
    dict.words = dict.words.filter((w) => !toRemove.has(w.toLowerCase()));
    const removed = before - dict.words.length;

    await putFile(DICT_PATH, JSON.stringify(dict, null, 2), `Remove ${removed} word${removed !== 1 ? "s" : ""} from custom dictionary`);
    resetSpellChecker();

    return NextResponse.json({ success: true, removed, total: dict.words.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update dictionary" },
      { status: 500 }
    );
  }
}
