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
  author?: string;
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

// ── Snippets ──

export interface Snippet {
  name: string;
  file: string; // relative path, e.g. "snippets/common-warning.mdx"
  content: string;
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

export interface SearchEntry {
  slug: string;
  title: string;
  category: string;
  section: string;
  bodyText: string; // stripped plain text for indexing
  filePath: string;
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
