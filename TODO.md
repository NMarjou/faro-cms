# Faro CMS — TODO / Revisit Later

A running list of deferred work and ideas to come back to. Keep each item to a
short description plus enough rationale that it's actionable later. Remove items
once they ship.

## UI / UX

- **Header bar — review, redesign & reorg.** The top header bar (title, "+ New"
  quick-create, page-specific actions, and the global search icon) has grown
  organically as features landed. Step back and review it holistically: redesign
  for visual clarity/consistency and reorganize what lives where — in particular
  the split between global actions (search, "+ New") and page-specific actions,
  and how this reads on both standard pages (`PageHeader`) and the editor's own
  header.

## Content model

- **Renaming a condition tag.** The conditions manager (`/conditions`) can add,
  recolour and delete tags, but not rename one. A rename is a CASCADE, not an
  edit: the tag is referenced by `TocArticle.tags` (labels) *and* embedded in
  article bodies as `data-tags` on every conditional block/mark. Renaming
  without rewriting both would silently strip that content from published output
  (the tag would no longer match a selected audience). Model it on
  `/api/article-move`, which already does a rename-plus-cascade, and reuse
  `lib/conditions-usage.ts` to find every affected article.

## Testing

Vitest is set up (`npm test` / `npm run test:watch`). Covered so far:

- `lib/compile.test.ts` — the compile pipeline (what reaches published output).
- `lib/merged-config.test.ts` — the shared/project merge rules (what content a
  project actually sees).

Both were mutation-checked: reintroduce the bug, confirm a test fails. A test
that cannot fail is worthless.

Extend the same approach to the remaining high-consequence pure logic — the
search index builder (`lib/search-index.ts`) and the condition usage scanner
(`lib/conditions-usage.ts`) are the obvious next candidates.

## Known gaps

_(none open — add new ones here.)_
