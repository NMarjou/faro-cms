// ── Content Model ──

export interface TocArticle {
  title: string;
  file: string; // relative path, e.g. "help/passport/overview.html"
  slug: string;
  format?: "html" | "mdx"; // default: "html"
  tags?: string[];
  conditions?: string[];
  createdDate?: string;
  lastModified?: string;
  author?: string; // owner — email of the user who created the article (gates edit rights for the author role)
  assignedTo?: string[]; // emails of contributors the tech writer has shared this article with
  reviewsDone?: string[]; // emails of reviewers who have marked their review complete
  assignedBy?: string; // email of the tech writer who initiated the share (used for review-done notifications)
  /**
   * Tech-writer's article-level sign-off. Independent of `reviewsDone[]`
   * (which is per-contributor). Set true when the tech writer marks the
   * review complete; reset to undefined when reopened, when the article
   * is sent for review again, or when the article body is saved
   * (changed-since-signoff invalidates the approval). Publish is gated
   * on this when assignedTo is non-empty.
   */
  reviewComplete?: boolean;
  reviewCompletedBy?: string; // tech writer email who signed off
  reviewCompletedAt?: string; // ISO timestamp
  /**
   * Foundation for the Published status. Stays undefined until we wire up
   * a post-merge hook on the publish PR — once that exists it'll flip true
   * and the status helper will surface "Published" on the surfaces that
   * use it. Kept on the article entry (not the TOC root) so each article's
   * publish state can drift independently.
   */
  published?: boolean;
  publishedAt?: string; // ISO timestamp of the merge that published it
  // ── Author submit-for-approval ──
  // An author submits an owned article to request tech-writer sign-off.
  // `reviewComplete` above is the sign-off itself; this flags that an author
  // is waiting on it. Cleared when the owner edits the body or when published.
  approvalStatus?: "submitted";
  submittedBy?: string; // email of the author who submitted it for approval
  submittedAt?: string; // ISO date the article was submitted
}

export interface TocSection {
  name: string;
  slug: string;
  articles: TocArticle[];
  subsections?: TocSection[];
}

export interface TocCategory {
  name: string;
  slug: string;
  description: string;
  icon?: string;
  sections: TocSection[];
}

export interface Toc {
  categories: TocCategory[];
  articles?: TocArticle[]; // standalone articles not in any category/section
}

// ── Article ──

export interface ArticleFrontmatter {
  title: string;
  slug: string;
  category?: string;
  section?: string;
  tags?: string[];
  conditions?: string[];
  lastModified?: string;
  author?: string;
}

export interface Article {
  frontmatter: ArticleFrontmatter;
  content: string; // MDX body (without frontmatter)
  filePath: string; // relative path in content/
}

// ── Variables & Conditions ──

export interface Variables {
  [key: string]: string;
}

export interface VariableSet {
  name: string;
  slug: string;
  variables: Variables;
}

export interface VariableSetsData {
  sets: VariableSet[];
}

export interface ConditionsConfig {
  tags: string[];
  colors?: Record<string, string>;
}

// ── Images ──

/** Per-image metadata, keyed by the image's relative path (e.g. "images/foo/bar.png"). */
export interface ImageMeta {
  owner: string; // email of the user who uploaded the image
  uploadedAt: string; // ISO date the image was uploaded
}

export interface ImageMetadataMap {
  [file: string]: ImageMeta;
}

// ── Snippets ──

export interface Snippet {
  name: string;
  file: string; // relative path, e.g. "snippets/common-warning.mdx"
  content: string;
}

// ── Users & Roles ──

export type UserRole = "tech-writer" | "author" | "contributor";

export interface User {
  email: string;
  role: UserRole;
  name?: string;
}

export interface UsersData {
  users: User[];
}

// ── Projects ──
// Multi-project manifest (CMS-content/projects.json). Each project owns its own
// toc.json + articles under projects/<slug>/; assets are shared via the pool
// (see lib/content-paths.ts). `publishTarget` is a placeholder for per-project
// output config wired in a later phase.

export interface Project {
  slug: string;
  name: string;
  description?: string;
  /** The default project content resolves to today (single-project phase). */
  default?: boolean;
  publishTarget?: {
    baseBranch?: string;
    workingBranch?: string;
  };
}

export interface ProjectsData {
  projects: Project[];
}

/** Seed list shown when CMS-content/users.json doesn't exist yet. */
export const DEFAULT_USERS: User[] = [
  { email: "nolwenn.marjou@beqom.com", role: "tech-writer", name: "Nolwenn Marjou" },
  { email: "anna.wyszynka@beqom.com", role: "tech-writer", name: "Anna Wyszynka" },
];

// ── Suggested edits ──

export type SuggestionStatus = "pending" | "accepted" | "rejected";

export interface Suggestion {
  id: string;
  /** Email of the contributor who proposed the change. */
  author: string;
  authorName?: string;
  createdAt: string;
  /** The text the contributor highlighted in the article body. */
  originalText: string;
  /** The contributor's proposed replacement. */
  suggestedText: string;
  status: SuggestionStatus;
  /**
   * Zero-based index of which occurrence of `originalText` in the article body
   * the suggestion targets — used to disambiguate when the same span appears
   * more than once. Captured at submit time from the contributor's selection.
   */
  occurrenceIndex?: number;
  /** Optional message from the contributor explaining the edit. */
  note?: string;
}

export interface SuggestionsData {
  suggestions: Suggestion[];
}

// ── GitHub API ──

export interface GitHubFile {
  path: string;
  content: string;
  sha: string;
  encoding: string;
}

export interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

export interface PublishResult {
  branch: string;
  prUrl: string;
  previewUrl?: string;
}

// ── Search ──

/** The kinds of object the cross-platform search can surface. */
export type SearchObjectType =
  | "article"
  | "snippet"
  | "image"
  | "variable"
  | "glossary"
  | "condition"
  | "style";

/**
 * A single unified search hit spanning every content object type. The index is
 * contextual to the current project but includes shared objects (the merged
 * loaders already union shared + project), with `scope` marking each hit's
 * origin. `bodyText` is present only for full-text types (articles, snippets,
 * glossary definitions, variable values); name-only types omit it.
 */
export interface SearchResult {
  type: SearchObjectType;
  id: string; // stable key, e.g. "glossary:SSO" or "article:help/x.html"
  title: string; // the object's primary name/title (always searchable)
  subtitle?: string; // context line: category/section, folder, set name, etc.
  bodyText?: string; // stripped full text, when the object has one
  scope: "shared" | "project";
  href: string; // client route that opens the object
  // Article-only status fields, mirrored so results can render a status badge.
  assignedTo?: string[];
  reviewComplete?: boolean;
  published?: boolean;
  score?: number; // attached at query time (lower = better, Fuse convention)
}

// ── Glossary ──

export interface GlossaryTerm {
  term: string;
  definition: string;
}

export interface Glossary {
  terms: GlossaryTerm[];
}

// ── Styles ──

export interface ContentStyle {
  name: string;
  class: string;
  element: "div" | "p" | "span";
}

// ── QA ──

export interface QAIssue {
  type: "broken-link" | "stale-article" | "orphan-article" | "missing-image" | "empty-article" | "spelling";
  severity: "error" | "warning" | "info";
  file: string;
  message: string;
  detail?: string;
}

// ── Editor ──

export type MessageBoxType = "info" | "tip" | "warning";

export interface EditorState {
  isDirty: boolean;
  isSaving: boolean;
  lastSaved?: string;
  currentBranch: string;
}
