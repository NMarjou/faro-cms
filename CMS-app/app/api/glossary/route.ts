import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile } from "@/lib/storage";
import type { Glossary } from "@/lib/types";

async function loadGlossary(): Promise<Glossary> {
  try {
    const file = await getFile("content/glossary.json");
    return JSON.parse(file.content);
  } catch {
    return { terms: [] };
  }
}

export async function GET() {
  const glossary = await loadGlossary();
  return NextResponse.json(glossary);
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { glossary } = body;
    if (!glossary) {
      return NextResponse.json({ error: "glossary is required" }, { status: 400 });
    }
    await putFile(
      "content/glossary.json",
      JSON.stringify(glossary, null, 2),
      "Update glossary"
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save glossary";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
