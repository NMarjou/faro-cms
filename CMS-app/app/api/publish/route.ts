import { NextRequest, NextResponse } from "next/server";
import {
  createBranch,
  createPR,
  branchExists,
  defaultBranch,
  workingBranch,
  ensureWorkingBranch,
} from "@/lib/github";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, branch: explicitBranch } = body;

    if (!title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    // Publish opens a PR from the branch editor saves land on (the working
    // branch by default) into the repo's default branch. The head must exist
    // and must differ from base; otherwise GitHub will refuse the PR.
    const base = defaultBranch();
    const head = explicitBranch || workingBranch();

    if (head === base) {
      return NextResponse.json(
        {
          error:
            "Working branch equals the default branch — nothing to publish. Set CMS_WORKING_BRANCH to a separate branch so edits land there first.",
        },
        { status: 400 }
      );
    }

    if (!explicitBranch) await ensureWorkingBranch();
    else if (!(await branchExists(head))) await createBranch(head);

    const pr = await createPR(
      title,
      description || "Content update from CMS editor",
      head,
      base
    );

    return NextResponse.json({
      branch: head,
      prUrl: pr.url,
      prNumber: pr.number,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to publish";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
