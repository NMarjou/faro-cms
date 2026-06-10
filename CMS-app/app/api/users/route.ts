import { NextRequest, NextResponse } from "next/server";
import { getFile, putFile } from "@/lib/storage";
import { DEFAULT_USERS, type User, type UsersData } from "@/lib/types";
import { notifyContributorInvited } from "@/lib/notifications";

const USERS_PATH = "content/users.json";

/** Read the existing users.json (or fall back to defaults) without throwing. */
async function loadExistingUsers(): Promise<User[]> {
  try {
    const file = await getFile(USERS_PATH);
    const data = JSON.parse(file.content) as UsersData;
    return data.users || DEFAULT_USERS;
  } catch {
    return DEFAULT_USERS;
  }
}

/**
 * GET /api/users
 * Returns the persisted users.json. If the file doesn't exist yet, returns the
 * seeded default tech writers so the UI has something to display. The defaults
 * are persisted on the next save.
 */
export async function GET() {
  try {
    const file = await getFile(USERS_PATH);
    const data = JSON.parse(file.content) as UsersData;
    if (!data.users || !Array.isArray(data.users)) {
      return NextResponse.json({ users: DEFAULT_USERS });
    }
    return NextResponse.json(data);
  } catch {
    // File doesn't exist yet — return the seed.
    return NextResponse.json({ users: DEFAULT_USERS });
  }
}

/**
 * PUT /api/users
 * Body: { users: User[] }
 * Replaces the full users list. The platform settings UI sends the entire
 * array on every change — small enough that diffing isn't worth it.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || !Array.isArray(body.users)) {
      return NextResponse.json(
        { error: "users array is required" },
        { status: 400 }
      );
    }

    // Light validation — must have email and role per entry.
    for (const u of body.users) {
      if (!u || typeof u.email !== "string" || !u.email.trim()) {
        return NextResponse.json(
          { error: "every user needs an email" },
          { status: 400 }
        );
      }
      if (
        u.role !== "tech-writer" &&
        u.role !== "author" &&
        u.role !== "contributor"
      ) {
        return NextResponse.json(
          { error: `invalid role for ${u.email}` },
          { status: 400 }
        );
      }
    }

    // Diff against the previous list to detect newly-added contributors and
    // authors so we can fire welcome notifications for them. Email is the
    // unique key.
    const previous = await loadExistingUsers();
    const previousEmails = new Set(previous.map((u) => u.email.toLowerCase()));
    const newContributors = (body.users as User[]).filter(
      (u) =>
        (u.role === "contributor" || u.role === "author") &&
        !previousEmails.has(u.email.toLowerCase())
    );

    const data: UsersData = { users: body.users };
    const result = await putFile(
      USERS_PATH,
      JSON.stringify(data, null, 2),
      body.message || "Update users & roles"
    );

    // Fan out welcome notifications. Don't await — the response shouldn't be
    // gated on email/Slack latency, and individual failures already log
    // internally without throwing.
    if (newContributors.length > 0) {
      void Promise.all(
        newContributors.map((c) =>
          notifyContributorInvited({ email: c.email, name: c.name })
        )
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save users";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
