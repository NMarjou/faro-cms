import type { Toc, TocSection } from "./types";
import type { ZendeskMap } from "./zendesk-map";

/**
 * Reconcile the Faro TOC tree against a help centre that ALREADY EXISTS in
 * Zendesk — the read-only heart of bootstrapping.
 *
 * The dangerous moment in this integration is the very first match: three help
 * centres already hold content, so if Faro's "Help" links to the wrong Zendesk
 * category, the next sync updates the wrong articles — and Zendesk has no undo
 * Faro can drive. So matching is deliberately conservative and NEVER writes:
 *
 *   • an id already in the map wins outright (identity, not name)     → "linked"
 *   • exactly one Zendesk object of the same name, unclaimed          → "matched"
 *   • more than one same-named candidate                              → "ambiguous"
 *   • none                                                            → "create"
 *   • mapped id no longer present in Zendesk                          → "stale"
 *
 * A "matched" node is a PROPOSAL a human confirms; only then is the id written
 * to the map and names stop mattering. Nothing here mutates Zendesk or the map.
 */

export interface ZdCategory {
  id: number;
  name: string;
}
export interface ZdSection {
  id: number;
  name: string;
  category_id: number;
  parent_section_id?: number | null;
}

export type MatchStatus = "linked" | "matched" | "ambiguous" | "create" | "stale";

export interface ReconcileNode {
  kind: "category" | "section";
  /** Faro identity: a category slug, or a section PATH ("cat/sec/…"). */
  faroKey: string;
  name: string;
  /** Resolved/proposed Zendesk id (set for linked and matched). */
  zendeskId?: number;
  status: MatchStatus;
  /** For "ambiguous": the same-named Zendesk objects to choose between. */
  candidates?: { id: number; name: string }[];
  children: ReconcileNode[];
}

export interface ReconcilePlan {
  nodes: ReconcileNode[];
  /** Present in Zendesk, absent from Faro. Never touched — reported so a human
   *  can decide. Faro is not (yet) the source of truth for these help centres. */
  orphans: {
    categories: { id: number; name: string }[];
    sections: { id: number; name: string; category_id: number }[];
  };
  /** Rollups for the UI: how many nodes need creating, need a decision, etc. */
  summary: Record<MatchStatus, number>;
}

/** Match key: case- and whitespace-insensitive. Zendesk titles are free text, so
 *  "Getting Started" and "getting started " must be treated as the same name. */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Index items by normalised name → the items sharing it (duplicates matter: two
 *  Zendesk categories named "Help" make any Faro "Help" ambiguous, not matched). */
function byName<T extends { name: string }>(items: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = norm(it.name);
    (m.get(k) ?? m.set(k, []).get(k)!).push(it);
  }
  return m;
}

/**
 * Reconcile a TOC against the fetched Zendesk categories/sections and the
 * project's current map. Pure: same inputs → same plan, no I/O.
 */
export function reconcile(
  toc: Toc,
  existing: { categories: ZdCategory[]; sections: ZdSection[] },
  map: ZendeskMap
): ReconcilePlan {
  const catIds = new Set(existing.categories.map((c) => c.id));
  const sectionIds = new Set(existing.sections.map((s) => s.id));
  const catByName = byName(existing.categories);
  const summary: Record<MatchStatus, number> = {
    linked: 0, matched: 0, ambiguous: 0, create: 0, stale: 0,
  };

  // Ids already spoken for — by the map, or by a sibling matched earlier this
  // run — so two Faro nodes can never both claim the same Zendesk object.
  const claimedCats = new Set<number>(Object.values(map.categories));
  const claimedSections = new Set<number>(Object.values(map.sections));

  const decideCategory = (slug: string, name: string): Pick<ReconcileNode, "status" | "zendeskId" | "candidates"> => {
    const mapped = map.categories[slug];
    if (mapped !== undefined) {
      return catIds.has(mapped)
        ? { status: "linked", zendeskId: mapped }
        : { status: "stale", zendeskId: mapped }; // mapped id vanished from Zendesk
    }
    const cands = (catByName.get(norm(name)) ?? []).filter((c) => !claimedCats.has(c.id));
    if (cands.length === 1) {
      claimedCats.add(cands[0].id);
      return { status: "matched", zendeskId: cands[0].id };
    }
    if (cands.length > 1) return { status: "ambiguous", candidates: cands.map((c) => ({ id: c.id, name: c.name })) };
    return { status: "create" };
  };

  const decideSection = (
    path: string,
    name: string,
    parentCatId: number | undefined,
    parentSectionId: number | null
  ): Pick<ReconcileNode, "status" | "zendeskId" | "candidates"> => {
    const mapped = map.sections[path];
    if (mapped !== undefined) {
      return sectionIds.has(mapped)
        ? { status: "linked", zendeskId: mapped }
        : { status: "stale", zendeskId: mapped };
    }
    // A section can only be matched inside a KNOWN Zendesk category, at the right
    // nesting level. If the parent category isn't resolved yet (create/ambiguous/
    // stale), the section can't be matched — it'll be created once its parent is.
    if (parentCatId === undefined) return { status: "create" };
    const siblings = existing.sections.filter(
      (s) =>
        s.category_id === parentCatId &&
        (s.parent_section_id ?? null) === parentSectionId &&
        norm(s.name) === norm(name) &&
        !claimedSections.has(s.id)
    );
    if (siblings.length === 1) {
      claimedSections.add(siblings[0].id);
      return { status: "matched", zendeskId: siblings[0].id };
    }
    if (siblings.length > 1) return { status: "ambiguous", candidates: siblings.map((s) => ({ id: s.id, name: s.name })) };
    return { status: "create" };
  };

  const walkSection = (
    sec: TocSection,
    trailKeys: string[],
    parentCatId: number | undefined,
    parentSectionId: number | null
  ): ReconcileNode => {
    const path = [...trailKeys, sec.slug].join("/");
    const decision = decideSection(path, sec.name, parentCatId, parentSectionId);
    summary[decision.status]++;
    const zdId = decision.zendeskId ?? null;
    return {
      kind: "section",
      faroKey: path,
      name: sec.name,
      ...decision,
      children: (sec.subsections ?? []).map((sub) =>
        // Subsections resolve within the SAME category, nested under this section.
        walkSection(sub, [...trailKeys, sec.slug], parentCatId, zdId)
      ),
    };
  };

  const nodes: ReconcileNode[] = (toc.categories ?? []).map((cat) => {
    const decision = decideCategory(cat.slug, cat.name);
    summary[decision.status]++;
    const catId = decision.zendeskId; // undefined for create/ambiguous → sections create
    return {
      kind: "category" as const,
      faroKey: cat.slug,
      name: cat.name,
      ...decision,
      children: (cat.sections ?? []).map((sec) => walkSection(sec, [cat.slug], catId, null)),
    };
  });

  // Orphans: Zendesk objects no Faro node claimed. Reported, never deleted — a
  // sync that deletes is a sync you can't safely run twice.
  const orphanCats = existing.categories.filter((c) => !claimedCats.has(c.id));
  const orphanCatIds = new Set(orphanCats.map((c) => c.id));
  const orphanSections = existing.sections.filter(
    (s) => !claimedSections.has(s.id) && !orphanCatIds.has(s.category_id)
  );

  return {
    nodes,
    orphans: {
      categories: orphanCats.map((c) => ({ id: c.id, name: c.name })),
      sections: orphanSections.map((s) => ({ id: s.id, name: s.name, category_id: s.category_id })),
    },
    summary,
  };
}
