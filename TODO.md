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

Vitest is set up (`npm test` / `npm run test:watch`). The compile pipeline is
covered — see `CMS-app/lib/compile.test.ts`. Extend the same approach to other
high-consequence, pure logic as it appears (e.g. the merge/override rules in
`lib/merged-config.ts`, the search index builder).

## Known gaps

_(none open — add new ones here.)_
