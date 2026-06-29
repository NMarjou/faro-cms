// One-time migration: re-home the single content tree into the multi-project
// layout (Phase 0). Moves shared assets into shared/ and the project's articles
// + toc into projects/<slug>/, writes projects.json, and leaves users.json at
// the root. Uses `git mv` to preserve history. Idempotent: no-op if already
// migrated. Does NOT commit — review the diff, then commit yourself.
//
//   node scripts/migrate-to-projects.mjs            (slug defaults to "accelerate")
//   node scripts/migrate-to-projects.mjs my-slug "My Name"

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "..");
const contentRoot = path.join(repoRoot, "CMS-content");

const slug = process.argv[2] || "accelerate";
const name = process.argv[3] || "Accelerate";

const SHARED = [
  "snippets",
  "images",
  "variables.json",
  "glossary.json",
  "conditions.json",
  "styles.json",
  "editor-styles.css",
  "dictionary.json",
  "custom-dictionary.json",
];
const PROJECT = ["toc.json", "help", "apis", "release-notes", "technical-administration"];

function gitmv(from, to) {
  execSync(`git mv "${from}" "${to}"`, { cwd: repoRoot, stdio: "pipe" });
}

function main() {
  if (!fs.existsSync(contentRoot)) {
    console.error(`CMS-content not found at ${contentRoot}`);
    process.exit(1);
  }
  if (fs.existsSync(path.join(contentRoot, "projects"))) {
    console.log("Already migrated (CMS-content/projects exists) — nothing to do.");
    return;
  }

  const sharedDir = path.join(contentRoot, "shared");
  const projectDir = path.join(contentRoot, "projects", slug);
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });

  const moved = { shared: [], project: [] };
  for (const item of SHARED) {
    if (fs.existsSync(path.join(contentRoot, item))) {
      gitmv(`CMS-content/${item}`, `CMS-content/shared/${item}`);
      moved.shared.push(item);
    }
  }
  for (const item of PROJECT) {
    if (fs.existsSync(path.join(contentRoot, item))) {
      gitmv(`CMS-content/${item}`, `CMS-content/projects/${slug}/${item}`);
      moved.project.push(item);
    }
  }

  const manifest = {
    projects: [
      {
        slug,
        name,
        description: "beqom product knowledge base",
        default: true,
      },
    ],
  };
  fs.writeFileSync(
    path.join(contentRoot, "projects.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );

  console.log(`Migrated to multi-project layout (project: ${name} / ${slug}).`);
  console.log(`  shared/   ← ${moved.shared.join(", ") || "(none)"}`);
  console.log(`  projects/${slug}/ ← ${moved.project.join(", ") || "(none)"}`);
  console.log(`  wrote projects.json; users.json left at root.`);
  console.log(`\nReview the diff (git status) and commit when satisfied.`);
}

main();
