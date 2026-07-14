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

- **Review implementation of conditions.** Conditions (tags) have no dedicated
  management page — they're applied to articles from `/toc`, with no per-tag
  surface to view/edit/rename/delete a tag on its own. This is why search
  results for conditions open `/toc` rather than deep-linking to the tag (unlike
  variables/glossary/styles, which now deep-link + highlight the specific
  entry). Revisit whether conditions deserve a proper manager; if so, wire
  condition search results to deep-link into it.

## Testing

- **Add tests for the compile pipeline — especially conditional filtering.**
  This is the highest-consequence, least-guarded code in the system: it decides
  what reaches published output. It shipped broken and nobody noticed. In #49 we
  found conditional content was *never* stripped — `data-tags` is written
  HTML-escaped (`data-tags="[&quot;advanced&quot;]"`), the parser only read
  single quotes, `JSON.parse` threw on the entities, and the `catch` fell back to
  KEEPING the content. Gated material (e.g. `admin-only`) was published to every
  audience, silently.

  A regression here leaks confidential content and produces no error, so it can
  only be caught by an assertion. Cover, at minimum:
  - block + inline conditionals: KEPT for a matching audience, STRIPPED for a
    non-matching one, surrounding content intact;
  - no `activeTags` → everything kept;
  - nested markup (conditional blocks contain nested `<div>`s — a non-greedy
    regex matched the wrong boundary and orphaned gated content);
  - the editor's label chip (`⚡ advanced ×`) never reaches published output;
  - snippet and variable resolution, incl. unknown names.

  The repo has no test runner yet, so this means picking one (vitest is the
  natural fit for a Next.js/TS codebase) — the compile functions are pure and
  easy to test directly.

## Known gaps

- **`/toc` authz gap.** The page only blocks contributors, but every save goes
  through the tech-writer-only `/api/toc`. An author who reaches the URL sees all
  the editing controls and gets silent "Failed to save". Either gate the page to
  tech-writers (the nav already hides it) or add owner-authorized structural
  routes.
