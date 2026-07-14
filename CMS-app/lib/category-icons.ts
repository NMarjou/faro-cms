/**
 * Curated Phosphor icon slugs offered for TOC categories (TocCategory.icon).
 * Keeping this a short, shared list means the picker in /toc and every surface
 * that renders a category icon agree on what's valid. Slugs are passed straight
 * to <Icon name=… /> (the Phosphor web font).
 */
export const CATEGORY_ICONS = [
  "book-open",
  "file-text",
  "lifebuoy",
  "rocket",
  "code",
  "plug",
  "gear",
  "wrench",
  "graduation-cap",
  "note-pencil",
  "users",
  "shield-check",
  "chart-line",
  "database",
  "cloud",
  "terminal",
  "puzzle-piece",
  "lightbulb",
  "megaphone",
  "list-checks",
] as const;
