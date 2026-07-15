import type { ZdCategory, ZdSection } from "./zendesk-reconcile";

/**
 * Thin Zendesk Help Center REST client.
 *
 * Reads (listCategories/listSections) power the read-only bootstrap. Writes
 * (create category/section/article, upload attachment) power the outbound sync —
 * they mutate a customer's LIVE help centre, so they only run behind the
 * reviewed reconcile + confirm flow (see lib/zendesk-sync.ts) and the
 * canPublish permission gate.
 *
 * Config is per-deployment env, mirroring lib/github.ts:
 *   ZENDESK_SUBDOMAIN            e.g. "beqom"  → beqom.zendesk.com
 *   ZENDESK_EMAIL               an agent email
 *   ZENDESK_API_TOKEN           an API token (Admin → Apps and integrations → APIs)
 *   ZENDESK_PERMISSION_GROUP_ID required to CREATE articles (Guide managed perms)
 * Auth is HTTP Basic as `{email}/token:{api_token}` (Zendesk's token scheme).
 *
 * NOTE: the write calls below are implemented to the documented Help Center API
 * but have NOT been run against a live tenant (that needs a token). The sync
 * orchestration that drives them (lib/zendesk-sync.ts) is exercised with a mock
 * client, so its logic — ordering, id-write-back, hash-skip — is covered; the
 * wire format of these individual calls is the part a live run must confirm.
 */

export interface ZendeskConfig {
  subdomain: string;
  email: string;
  token: string;
}

/** Read Zendesk credentials from env, or explain exactly what's missing. */
export function getZendeskConfig(): ZendeskConfig {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const email = process.env.ZENDESK_EMAIL;
  const token = process.env.ZENDESK_API_TOKEN;
  const missing = [
    !subdomain && "ZENDESK_SUBDOMAIN",
    !email && "ZENDESK_EMAIL",
    !token && "ZENDESK_API_TOKEN",
  ].filter(Boolean);
  if (missing.length) throw new Error(`Zendesk is not configured: set ${missing.join(", ")}`);
  return { subdomain: subdomain!, email: email!, token: token! };
}

function authHeader(cfg: ZendeskConfig): string {
  const raw = `${cfg.email}/token:${cfg.token}`;
  return "Basic " + Buffer.from(raw).toString("base64");
}

/**
 * GET every page of a Help Center collection endpoint. Zendesk paginates at 100
 * and returns `next_page` until exhausted; stopping at page one would silently
 * reconcile against a PARTIAL help centre and propose creating things that
 * already exist further down.
 */
async function getAll<T>(cfg: ZendeskConfig, firstUrl: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: authHeader(cfg), Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zendesk ${res.status} on ${url}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as Record<string, unknown> & { next_page?: string | null };
    out.push(...((data[key] as T[]) ?? []));
    url = data.next_page ?? null;
  }
  return out;
}

function base(cfg: ZendeskConfig): string {
  return `https://${cfg.subdomain}.zendesk.com/api/v2/help_center`;
}

/** Fetch the help centre's categories for a locale. */
export async function listCategories(cfg: ZendeskConfig, locale: string): Promise<ZdCategory[]> {
  const rows = await getAll<{ id: number; name: string }>(
    cfg, `${base(cfg)}/${locale}/categories.json?per_page=100`, "categories"
  );
  return rows.map((c) => ({ id: c.id, name: c.name }));
}

/** Fetch the help centre's sections for a locale (all levels; subsections carry
 *  a non-null `parent_section_id`). */
export async function listSections(cfg: ZendeskConfig, locale: string): Promise<ZdSection[]> {
  const rows = await getAll<{ id: number; name: string; category_id: number; parent_section_id: number | null }>(
    cfg, `${base(cfg)}/${locale}/sections.json?per_page=100`, "sections"
  );
  return rows.map((s) => ({
    id: s.id, name: s.name, category_id: s.category_id, parent_section_id: s.parent_section_id ?? null,
  }));
}

// ── Writes ─────────────────────────────────────────────────────────────────

/** POST/PUT JSON and return the parsed body, surfacing Zendesk's error text. */
async function sendJson<T>(
  cfg: ZendeskConfig, method: "POST" | "PUT", url: string, body: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: authHeader(cfg), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zendesk ${res.status} on ${method} ${url}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Create a category. Returns its new id. */
export async function createCategory(
  cfg: ZendeskConfig, locale: string, input: { name: string; description?: string }
): Promise<number> {
  const data = await sendJson<{ category: { id: number } }>(
    cfg, "POST", `${base(cfg)}/${locale}/categories.json`,
    { category: { name: input.name, description: input.description ?? "" } }
  );
  return data.category.id;
}

/** Create a section under a category (nest it by passing a parentSectionId —
 *  Enterprise-only). Returns its new id. */
export async function createSection(
  cfg: ZendeskConfig, locale: string,
  input: { name: string; categoryId: number; parentSectionId?: number | null }
): Promise<number> {
  const section: Record<string, unknown> = { name: input.name };
  if (input.parentSectionId) section.parent_section_id = input.parentSectionId;
  const data = await sendJson<{ section: { id: number } }>(
    cfg, "POST", `${base(cfg)}/${locale}/categories/${input.categoryId}/sections.json`,
    { section }
  );
  return data.section.id;
}

/** The permission group new articles are created under. Guide requires one on
 *  create; there's no sensible default, so fail loudly rather than guess. */
function permissionGroupId(): number {
  const raw = process.env.ZENDESK_PERMISSION_GROUP_ID;
  const id = raw ? Number(raw) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Creating articles needs ZENDESK_PERMISSION_GROUP_ID (a Guide permission group id)");
  }
  return id;
}

/** Create an article, PUBLISHED LIVE (draft:false), visible to everyone
 *  (user_segment_id:null). Returns its id and public url. */
export async function createArticle(
  cfg: ZendeskConfig, locale: string, sectionId: number, input: { title: string; body: string }
): Promise<{ id: number; url: string }> {
  const data = await sendJson<{ article: { id: number; html_url: string } }>(
    cfg, "POST", `${base(cfg)}/${locale}/sections/${sectionId}/articles.json`,
    {
      article: {
        title: input.title,
        body: input.body,
        locale,
        draft: false, // publish live — the user's explicit choice
        user_segment_id: null, // everyone
        permission_group_id: permissionGroupId(),
      },
      notify_subscribers: false,
    }
  );
  return { id: data.article.id, url: data.article.html_url };
}

/** Update an existing article's translation and keep it published. */
export async function updateArticle(
  cfg: ZendeskConfig, locale: string, articleId: number, input: { title: string; body: string }
): Promise<{ id: number; url: string }> {
  await sendJson<unknown>(
    cfg, "PUT", `${base(cfg)}/articles/${articleId}/translations/${locale}.json`,
    { translation: { title: input.title, body: input.body, draft: false } }
  );
  const data = await sendJson<{ article: { id: number; html_url: string } }>(
    cfg, "PUT", `${base(cfg)}/articles/${articleId}.json`, { article: { draft: false } }
  );
  return { id: data.article.id, url: data.article.html_url };
}

/**
 * Upload an image as an unassociated inline article attachment. Returns the
 * public content_url to point the body's <img src> at; the attachment is bound
 * to the article when the article is saved with a body referencing that url.
 */
export async function uploadAttachment(
  cfg: ZendeskConfig, fileName: string, bytes: Buffer, contentType: string
): Promise<{ id: number; contentUrl: string }> {
  const form = new FormData();
  form.append("inline", "true");
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), fileName);
  const res = await fetch(`${base(cfg)}/articles/attachments.json`, {
    method: "POST",
    headers: { Authorization: authHeader(cfg), Accept: "application/json" },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zendesk ${res.status} on attachment upload (${fileName}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { article_attachment: { id: number; content_url: string } };
  return { id: data.article_attachment.id, contentUrl: data.article_attachment.content_url };
}
