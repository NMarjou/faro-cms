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
