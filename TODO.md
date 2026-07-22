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

## KB preview integration

A separate app (`../KB-preview`, Next.js on Vercel + Neon Postgres) hosts draft
content for reviewers who can't reach Faro, and collects comments and suggested
edits from them. Two pieces are needed on this side. Neither is built.

- **Serve the site bundle as JSON.** `buildSiteBundle` (`lib/site-bundle.ts`)
  already produces exactly what a downstream reader needs — `SitePage[]` plus
  `NavCategory[]`, with asset URLs re-hosted and internal links resolved — but
  the only HTTP surface over it is the ZIP at `POST /api/site/build`. The
  preview app therefore re-parses rendered HTML out of that ZIP, and a human
  uploads it by hand. A `GET /api/site/bundle` returning the bundle would
  replace both: the parsing and the manual step. Small change, high leverage.
  Note `report: true` is not a substitute — it returns counts, not pages.

- **Pull feedback back in.** The preview app exposes
  `GET /api/feedback?since=<ISO>` with a bearer token, returning payloads
  already shaped as `<article>.comments.json` and `<article>.suggestions.json`,
  keyed by article file path. What's missing here is a route that fetches it and
  merges into the sidecars via `mutateJsonFile` (`lib/sidecar.ts`), plus
  something to trigger it — there is no cron or job runner in this repo, so a
  tech-writer-gated button is the realistic mechanism. Model the auth on
  `app/api/webhooks/github/route.ts`, the existing authenticated inbound route.

  Three constraints the merge has to honour:
  - **Merge by `id`.** Delivery is at-least-once (a timestamp window, no shared
    cursor), so re-pulling the same window must be a no-op.
  - **Faro owns `status`.** The preview app only ever emits `pending`; a
    suggestion already accepted or rejected here must keep that status.
  - **Whole threads arrive when any comment in them is new,** so a reply whose
    parent shipped earlier still nests correctly. Don't append blindly.

- **Consider stable article IDs.** Feedback is keyed by `TocArticle.file`,
  because that's the only article identifier that exists. It isn't stable —
  `/api/article-move` renames it — so feedback collected against the old path is
  orphaned by a move. The preview app keeps such feedback rather than dropping
  it, but only a real UUID on the TOC entry would actually fix this. Worth
  weighing against how often articles move mid-review.

## Known gaps

_(none open — add new ones here.)_
