import { getFile, putFile } from "./storage";

/**
 * The persisted Faro → Zendesk identity map, one per project (= one help
 * centre). This file is the reason a sync can run twice safely.
 *
 * Zendesk categories, sections and articles are identified by NUMERIC ID, not by
 * name. If we matched by name at sync time, renaming a Faro category would make
 * the next sync fail to find its Zendesk counterpart and CREATE A SECOND ONE —
 * the classic way this integration silently duplicates a customer's help centre.
 *
 * So identity is recorded once (during the reviewed bootstrap) and then names
 * stop mattering: a rename in Faro updates the mapped Zendesk object in place.
 *
 * Stored at `content/zendesk-map.json`, which the path layer roots under the
 * project's own space (projects/<slug>/…), exactly like toc.json — so each
 * project carries its own map without any extra plumbing.
 */

export const ZENDESK_MAP_PATH = "content/zendesk-map.json";

/** What we remember about a synced article. `hash` lets a later sync skip
 *  unchanged articles instead of re-pushing every one. */
export interface ZendeskArticleRef {
  id: number;
  hash?: string;
}

export interface ZendeskMap {
  /** Zendesk brand this project's help centre lives under (one project → one
   *  brand). Recorded at bootstrap; sync refuses to run against a different one. */
  brandId?: number;
  /** Help-centre locale, e.g. "en-us". Zendesk keys articles by locale. */
  locale: string;
  /** Faro category slug → Zendesk category id. */
  categories: Record<string, number>;
  /** Faro section PATH ("categorySlug/sectionSlug/…") → Zendesk section id. */
  sections: Record<string, number>;
  /** Faro article file path → its Zendesk article. */
  articles: Record<string, ZendeskArticleRef>;
}

export function emptyMap(locale = "en-us"): ZendeskMap {
  return { locale, categories: {}, sections: {}, articles: {} };
}

/**
 * Load the current project's map. A missing file is not an error — it means the
 * project has never been bootstrapped, so we return an empty map and every node
 * reconciles as "create"/"matched".
 */
export async function loadZendeskMap(): Promise<ZendeskMap> {
  try {
    const file = await getFile(ZENDESK_MAP_PATH);
    const parsed = JSON.parse(file.content) as Partial<ZendeskMap>;
    // Tolerate a hand-edited or partial file: fill in the shape so callers never
    // hit an undefined bucket.
    return {
      brandId: parsed.brandId,
      locale: parsed.locale || "en-us",
      categories: parsed.categories ?? {},
      sections: parsed.sections ?? {},
      articles: parsed.articles ?? {},
    };
  } catch {
    return emptyMap();
  }
}

export async function saveZendeskMap(map: ZendeskMap, message: string): Promise<void> {
  await putFile(ZENDESK_MAP_PATH, JSON.stringify(map, null, 2), message);
}
