import { describe, it, expect, vi } from "vitest";

// merged-config imports ./storage (filesystem / GitHub). Only the pure merge
// functions are under test, so stub it out.
vi.mock("./storage", () => ({
  getCachedFile: vi.fn(),
  readProjectOverlay: vi.fn(),
}));

import {
  mergeVariableSets,
  mergeGlossary,
  mergeConditions,
  mergeStyles,
} from "./merged-config";
import type { VariableSetsData, Glossary, ConditionsConfig, ContentStyle } from "./types";

/**
 * These four functions decide WHAT CONTENT A PROJECT ACTUALLY SEES. Every
 * consumer — the editor's toolbar, the config managers, the compile pipeline —
 * reads through them.
 *
 * They share one contract, and one safety property:
 *
 *   1. SHARED IS NEVER LOST. A project overlay may ADD or OVERRIDE, but it can
 *      never hide a shared entry. If that broke, a project would silently lose
 *      shared content — variables would render as {placeholders}, gated content
 *      would stop matching its audience.
 *   2. The overlay is SPARSE and wins PER KEY (not whole-file), so a project
 *      keeps inheriting later shared additions.
 *   3. `scopes` attributes each entry's origin. It drives the shared/project
 *      badges AND the "revert" affordance, so a wrong scope means reverting the
 *      wrong thing.
 *   4. Order is stable: shared order preserved, project-only entries appended.
 */

describe("the shared/project contract (all four merge types)", () => {
  it("an overlay can never hide a shared entry", () => {
    // Every overlay below omits (or contradicts) the shared entries entirely.
    const vars = mergeVariableSets(
      { sets: [{ name: "General", slug: "general", variables: { a: "1" } }] },
      { sets: [{ name: "Other", slug: "other", variables: { b: "2" } }] }
    );
    expect(vars.merged.sets.find((s) => s.slug === "general")?.variables.a).toBe("1");

    const glossary = mergeGlossary(
      { terms: [{ term: "SSO", definition: "shared def" }] },
      { terms: [{ term: "HRIS", definition: "project def" }] }
    );
    expect(glossary.merged.terms.map((t) => t.term)).toContain("SSO");

    const conds = mergeConditions(
      { tags: ["admin-only"], colors: {} },
      { tags: ["beta"], colors: {} }
    );
    expect(conds.merged.tags).toContain("admin-only");

    const styles = mergeStyles(
      [{ name: "Code", class: "code", element: "span" }],
      [{ name: "Note", class: "note", element: "p" }]
    );
    expect(styles.merged.map((s) => s.class)).toContain("code");
  });

  it("a null overlay yields exactly the shared pool, all scoped shared", () => {
    const v = mergeVariableSets({ sets: [{ name: "G", slug: "g", variables: { a: "1" } }] }, null);
    expect(v.merged.sets[0].variables).toEqual({ a: "1" });
    expect(v.scopes.g.a).toBe("shared");

    const g = mergeGlossary({ terms: [{ term: "T", definition: "d" }] }, null);
    expect(g.merged.terms).toEqual([{ term: "T", definition: "d" }]);
    expect(g.scopes.T).toBe("shared");

    const c = mergeConditions({ tags: ["x"], colors: { x: "#111" } }, null);
    expect(c.merged.tags).toEqual(["x"]);
    expect(c.scopes.x).toBe("shared");

    const s = mergeStyles([{ name: "N", class: "c", element: "p" }], null);
    expect(s.merged).toEqual([{ name: "N", class: "c", element: "p" }]);
    expect(s.scopes.c).toBe("shared");
  });
});

describe("mergeVariableSets", () => {
  const shared: VariableSetsData = {
    sets: [
      { name: "General", slug: "general", variables: { productName: "beqom", supportEmail: "a@b.c" } },
      { name: "Localization", slug: "l10n", variables: { locale: "en" } },
    ],
  };

  it("overrides a single key and leaves the rest of the set inherited", () => {
    // Sparse: overriding productName must NOT drop supportEmail.
    const { merged, scopes } = mergeVariableSets(shared, {
      sets: [{ name: "General", slug: "general", variables: { productName: "Acme" } }],
    });
    const general = merged.sets.find((s) => s.slug === "general")!;
    expect(general.variables).toEqual({ productName: "Acme", supportEmail: "a@b.c" });
    expect(scopes.general.productName).toBe("project");
    expect(scopes.general.supportEmail).toBe("shared");
  });

  it("adds a project-only key to an existing shared set", () => {
    const { merged, scopes } = mergeVariableSets(shared, {
      sets: [{ name: "General", slug: "general", variables: { extra: "x" } }],
    });
    const general = merged.sets.find((s) => s.slug === "general")!;
    expect(general.variables.extra).toBe("x");
    expect(general.variables.productName).toBe("beqom"); // still inherited
    expect(scopes.general.extra).toBe("project");
  });

  it("appends an overlay-only SET, with every key project-scoped", () => {
    const { merged, scopes } = mergeVariableSets(shared, {
      sets: [{ name: "Custom", slug: "custom", variables: { k: "v" } }],
    });
    expect(merged.sets.map((s) => s.slug)).toEqual(["general", "l10n", "custom"]); // appended, order stable
    expect(scopes.custom.k).toBe("project");
  });

  it("matches sets by slug, not by name", () => {
    const { merged } = mergeVariableSets(shared, {
      sets: [{ name: "RENAMED", slug: "general", variables: { productName: "Acme" } }],
    });
    // Same slug → merged into the existing set, not appended as a new one.
    expect(merged.sets.filter((s) => s.slug === "general")).toHaveLength(2 - 1);
    expect(merged.sets.find((s) => s.slug === "general")!.variables.productName).toBe("Acme");
  });
});

describe("mergeGlossary", () => {
  const shared: Glossary = {
    terms: [
      { term: "SSO", definition: "Single Sign-On" },
      { term: "KPI", definition: "Key Performance Indicator" },
    ],
  };

  it("overrides a definition IN PLACE (position preserved)", () => {
    const { merged, scopes } = mergeGlossary(shared, {
      terms: [{ term: "SSO", definition: "Project-specific wording" }],
    });
    expect(merged.terms.map((t) => t.term)).toEqual(["SSO", "KPI"]); // not reshuffled
    expect(merged.terms[0].definition).toBe("Project-specific wording");
    expect(scopes.SSO).toBe("project");
    expect(scopes.KPI).toBe("shared");
  });

  it("appends project-only terms after the shared ones", () => {
    const { merged, scopes } = mergeGlossary(shared, {
      terms: [{ term: "HRIS", definition: "HR Information System" }],
    });
    expect(merged.terms.map((t) => t.term)).toEqual(["SSO", "KPI", "HRIS"]);
    expect(scopes.HRIS).toBe("project");
  });
});

describe("mergeConditions", () => {
  const shared: ConditionsConfig = {
    tags: ["admin-only", "passport"],
    colors: { "admin-only": "#ef4444", passport: "#3b82f6" },
  };

  it("unions the tags — shared order first, project-only appended", () => {
    const { merged } = mergeConditions(shared, { tags: ["beta"], colors: {} });
    expect(merged.tags).toEqual(["admin-only", "passport", "beta"]);
  });

  it("does not duplicate a tag the overlay repeats", () => {
    const { merged } = mergeConditions(shared, { tags: ["passport"], colors: {} });
    expect(merged.tags).toEqual(["admin-only", "passport"]);
  });

  it("recolouring a shared tag marks it project-scoped WITHOUT making it project-only", () => {
    // This is the distinction the manager's badge and Revert button depend on.
    const { merged, scopes } = mergeConditions(shared, { tags: [], colors: { passport: "#000000" } });
    expect(merged.colors!.passport).toBe("#000000");
    expect(scopes.passport).toBe("project"); // recoloured → project
    expect(merged.tags).toContain("passport"); // but still a shared tag
    expect(scopes["admin-only"]).toBe("shared"); // untouched
  });

  it("a project CANNOT hide a shared tag, even by omitting it", () => {
    // Gated content references tags by name. If a project could drop a shared
    // tag, that content would stop matching any audience and vanish at compile.
    const { merged, scopes } = mergeConditions(shared, { tags: ["beta"], colors: {} });
    expect(merged.tags).toContain("admin-only");
    expect(merged.tags).toContain("passport");
    expect(scopes["admin-only"]).toBe("shared");
  });

  it("tolerates missing colors on either side", () => {
    const { merged } = mergeConditions({ tags: ["x"] }, { tags: ["y"] });
    expect(merged.tags).toEqual(["x", "y"]);
    expect(merged.colors).toEqual({});
  });
});

describe("mergeStyles", () => {
  const shared: ContentStyle[] = [
    { name: "Code", class: "code", element: "span" },
    { name: "Figure Caption", class: "figure-caption", element: "p" },
  ];

  it("overrides by class, in place", () => {
    const { merged, scopes } = mergeStyles(shared, [
      { name: "Inline Code", class: "code", element: "span" },
    ]);
    expect(merged.map((s) => s.class)).toEqual(["code", "figure-caption"]); // order stable
    expect(merged[0].name).toBe("Inline Code");
    expect(scopes.code).toBe("project");
    expect(scopes["figure-caption"]).toBe("shared");
  });

  it("appends project-only styles", () => {
    const { merged, scopes } = mergeStyles(shared, [{ name: "Note", class: "note", element: "div" }]);
    expect(merged.map((s) => s.class)).toEqual(["code", "figure-caption", "note"]);
    expect(scopes.note).toBe("project");
  });
});
