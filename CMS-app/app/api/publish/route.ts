import { NextRequest, NextResponse } from "next/server";
import { createBranch, createPR, branchExists } from "@/lib/github";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, branch: existingBranch } = body;

    if (!title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    // Use existing branch or create new one
    let branch = existingBranch;
    if (!branch) {
      const timestamp = Date.now();
      branch = `content-update/${timestamp}`;
    }

    const exists = await branchExists(branch);
    if (!exists) {
      await createBranch(branch);
    }

    // Create PR
    const pr = await createPR(
      title,
      description || "Content update from CMS editor",
      branch
    );

    return NextResponse.json({
      branch,
      prUrl: pr.url,
      prNumber: pr.number,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to publish";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
