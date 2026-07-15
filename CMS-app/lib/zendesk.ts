import type { ZdCategory, ZdSection } from "./zendesk-reconcile";

/**
 * Thin Zendesk Help Center REST client.
 *
 * Read-only for now — the bootstrap step needs to SEE a help centre's existing
 * categories and sections before anything is matched or written. The create/
 * update calls (which mutate a customer's live help centre) land in the next
 * slice, deliberately gated behind the reviewed reconcile.
 *
 * Config is per-deployment env, mirroring lib/github.ts:
 *   ZENDESK_SUBDOMAIN   e.g. "beqom"  → beqom.zendesk.com
 *   ZENDESK_EMAIL       an agent email
 *   ZENDESK_API_TOKEN   an API token (Admin → Apps and integrations → APIs)
 * Auth is HTTP Basic as `{email}/token:{api_token}` (Zendesk's token scheme).
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
