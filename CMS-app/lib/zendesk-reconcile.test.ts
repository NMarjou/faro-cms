import { describe, it, expect } from "vitest";
import { reconcile } from "./zendesk-reconcile";
import type { ZdCategory, ZdSection } from "./zendesk-reconcile";
import { emptyMap } from "./zendesk-map";
import type { ZendeskMap } from "./zendesk-map";
import type { Toc } from "./types";

/**
 * Reconcile decides which existing Zendesk object each Faro node links to — and
 * a wrong link means the next sync overwrites the wrong customer-facing article,
 * with no undo. So every branch here is asserted, not assumed.
 *
 * The failure this guards against is silent: a mislink renders nothing unusual;
 * it just points at the wrong id.
 */

const cat = (slug: string, name: string, sections: Toc["categories"][number]["sections"] = []) => ({
  slug, name, description: "", sections,
});
const sec = (slug: string, name: string, subsections: any[] = []) => ({
  slug, name, articles: [], subsections,
});
const toc = (categories: Toc["categories"]): Toc => ({ categories });

const zcat = (id: number, name: string): ZdCategory => ({ id, name });
const zsec = (id: number, name: string, category_id: number, parent_section_id: number | null = null): ZdSection => ({
  id, name, category_id, parent_section_id,
});

describe("reconcile — categories", () => {
  it("LINKS a category already in the map by id, not by name", () => {
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 } };
    // Note the Zendesk name differs from Faro's — identity must win over name.
    const plan = reconcile(toc([cat("help", "Help & Support")]), { categories: [zcat(500, "Assistance")], sections: [] }, map);
    expect(plan.nodes[0].status).toBe("linked");
    expect(plan.nodes[0].zendeskId).toBe(500);
  });

  it("MATCHES an unmapped category to the sole same-named Zendesk category", () => {
    const plan = reconcile(toc([cat("help", "Help")]), { categories: [zcat(500, "help ")], sections: [] }, emptyMap());
    expect(plan.nodes[0].status).toBe("matched");
    expect(plan.nodes[0].zendeskId).toBe(500); // normalised name + trailing space
  });

  it("flags AMBIGUOUS when two Zendesk categories share the name", () => {
    const plan = reconcile(
      toc([cat("help", "Help")]),
      { categories: [zcat(500, "Help"), zcat(501, "HELP")], sections: [] },
      emptyMap()
    );
    expect(plan.nodes[0].status).toBe("ambiguous");
    expect(plan.nodes[0].zendeskId).toBeUndefined();
    expect(plan.nodes[0].candidates?.map((c) => c.id).sort()).toEqual([500, 501]);
  });

  it("marks CREATE when no Zendesk category matches", () => {
    const plan = reconcile(toc([cat("new", "Brand New")]), { categories: [zcat(500, "Help")], sections: [] }, emptyMap());
    expect(plan.nodes[0].status).toBe("create");
    expect(plan.orphans.categories).toEqual([{ id: 500, name: "Help" }]);
  });

  it("marks STALE when a mapped id no longer exists in Zendesk", () => {
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 999 } };
    const plan = reconcile(toc([cat("help", "Help")]), { categories: [zcat(500, "Help")], sections: [] }, map);
    expect(plan.nodes[0].status).toBe("stale");
    // The vanished id must not be silently re-matched to the same-named 500.
    expect(plan.nodes[0].zendeskId).toBe(999);
  });

  it("never lets two Faro categories claim the same Zendesk category", () => {
    // Both named "Help"; only one Zendesk "Help" exists. First claims it, the
    // second must NOT double-claim — it becomes create (no unclaimed candidate).
    const plan = reconcile(
      toc([cat("help", "Help"), cat("help-2", "Help")]),
      { categories: [zcat(500, "Help")], sections: [] },
      emptyMap()
    );
    expect(plan.nodes[0].status).toBe("matched");
    expect(plan.nodes[0].zendeskId).toBe(500);
    expect(plan.nodes[1].status).toBe("create");
    // And the claimed category is not reported as an orphan.
    expect(plan.orphans.categories).toEqual([]);
  });
});

describe("reconcile — sections", () => {
  it("matches a section only INSIDE its resolved parent category", () => {
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 } };
    const plan = reconcile(
      toc([cat("help", "Help", [sec("passport", "Passport")])]),
      { categories: [zcat(500, "Help")], sections: [zsec(700, "Passport", 500)] },
      map
    );
    const section = plan.nodes[0].children[0];
    expect(section.status).toBe("matched");
    expect(section.zendeskId).toBe(700);
    expect(section.faroKey).toBe("help/passport");
  });

  it("does NOT match a same-named section that lives in a different category", () => {
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 } };
    const plan = reconcile(
      toc([cat("help", "Help", [sec("passport", "Passport")])]),
      { categories: [zcat(500, "Help")], sections: [zsec(700, "Passport", 999)] }, // wrong category
      map
    );
    expect(plan.nodes[0].children[0].status).toBe("create");
  });

  it("forces CREATE on sections when the parent category is unresolved", () => {
    // Parent is ambiguous → no known Zendesk category id → the section cannot be
    // matched even if a same-named section exists somewhere.
    const plan = reconcile(
      toc([cat("help", "Help", [sec("passport", "Passport")])]),
      { categories: [zcat(500, "Help"), zcat(501, "Help")], sections: [zsec(700, "Passport", 500)] },
      emptyMap()
    );
    expect(plan.nodes[0].status).toBe("ambiguous");
    expect(plan.nodes[0].children[0].status).toBe("create");
  });

  it("matches a subsection under its parent section (parent_section_id)", () => {
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 }, sections: { "help/passport": 700 } };
    const plan = reconcile(
      toc([cat("help", "Help", [sec("passport", "Passport", [sec("setup", "Setup")])])]),
      {
        categories: [zcat(500, "Help")],
        sections: [zsec(700, "Passport", 500), zsec(701, "Setup", 500, 700)],
      },
      map
    );
    const subsection = plan.nodes[0].children[0].children[0];
    expect(subsection.status).toBe("matched"); // 701 is "Setup" nested under parent section 700
    expect(subsection.zendeskId).toBe(701);
    expect(subsection.faroKey).toBe("help/passport/setup");
  });

  it("does NOT match a subsection sitting at the wrong nesting level", () => {
    // A section named "Setup" exists in the category but at TOP level (no
    // parent_section_id). The Faro "Setup" is a SUBSECTION → must not link to it.
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 }, sections: { "help/passport": 700 } };
    const plan = reconcile(
      toc([cat("help", "Help", [sec("passport", "Passport", [sec("setup", "Setup")])])]),
      {
        categories: [zcat(500, "Help")],
        sections: [zsec(700, "Passport", 500), zsec(800, "Setup", 500, null)], // top-level, not under 700
      },
      map
    );
    expect(plan.nodes[0].children[0].children[0].status).toBe("create");
  });

  it("does NOT mislink a subsection to a top-level section when its parent section is unresolved", () => {
    // Regression: null was used for both "top level" and "parent unresolved", so
    // a subsection under a to-be-CREATED section matched an unrelated TOP-LEVEL
    // Zendesk section — a mislink the module exists to prevent.
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 } };
    const plan = reconcile(
      toc([cat("help", "Help", [sec("passport", "Passport", [sec("setup", "Setup")])])]),
      {
        categories: [zcat(500, "Help")],
        // "Passport" is NOT in Zendesk (→ create); an unrelated TOP-LEVEL "Setup"
        // exists in the same category.
        sections: [zsec(800, "Setup", 500, null)],
      },
      map
    );
    const passport = plan.nodes[0].children[0];
    expect(passport.status).toBe("create");
    const setup = passport.children[0];
    expect(setup.status).toBe("create"); // must NOT link to 800
    expect(setup.zendeskId).toBeUndefined();
  });

  it("forces CREATE on a subsection whose parent section is stale (mapped id gone)", () => {
    // A stale parent's id no longer exists in Zendesk, so its children can't be
    // nested under it — they must be created, not matched by name.
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 }, sections: { "help/passport": 999 } };
    const plan = reconcile(
      toc([cat("help", "Help", [sec("passport", "Passport", [sec("setup", "Setup")])])]),
      { categories: [zcat(500, "Help")], sections: [zsec(800, "Setup", 500, null)] },
      map
    );
    expect(plan.nodes[0].children[0].status).toBe("stale");
    expect(plan.nodes[0].children[0].children[0].status).toBe("create");
  });

  it("reports an unmatched section in a matched category as an orphan", () => {
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 } };
    const plan = reconcile(
      toc([cat("help", "Help", [sec("passport", "Passport")])]),
      { categories: [zcat(500, "Help")], sections: [zsec(700, "Passport", 500), zsec(701, "Legacy", 500)] },
      map
    );
    expect(plan.orphans.sections).toEqual([{ id: 701, name: "Legacy", category_id: 500 }]);
  });

  it("does NOT report an ambiguous node's candidates as orphans", () => {
    // The user is choosing among them — reporting them as "in Zendesk, not in
    // Faro, never deleted" would be misleading.
    const plan = reconcile(
      toc([cat("help", "Help")]),
      { categories: [zcat(500, "Help"), zcat(501, "Help")], sections: [] },
      emptyMap()
    );
    expect(plan.nodes[0].status).toBe("ambiguous");
    expect(plan.orphans.categories).toEqual([]); // neither candidate is an orphan
  });

  it("does not double-report sections whose category is already an orphan", () => {
    // Category 900 has no Faro counterpart → orphan. Its sections are implicitly
    // orphaned; reporting them again would be noise.
    const plan = reconcile(
      toc([cat("help", "Help")]),
      { categories: [zcat(500, "Help"), zcat(900, "Old KB")], sections: [zsec(950, "Archive", 900)] },
      emptyMap()
    );
    expect(plan.orphans.categories).toEqual([{ id: 900, name: "Old KB" }]);
    expect(plan.orphans.sections).toEqual([]); // not double-counted
  });
});

describe("reconcile — summary", () => {
  it("rolls up node counts by status", () => {
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 } };
    const plan = reconcile(
      toc([
        cat("help", "Help", [sec("passport", "Passport"), sec("new", "New Section")]),
        cat("apis", "APIs"),
      ]),
      { categories: [zcat(500, "Help"), zcat(600, "APIs")], sections: [zsec(700, "Passport", 500)] },
      map
    );
    expect(plan.summary.linked).toBe(1); // help (mapped)
    expect(plan.summary.matched).toBe(2); // passport section + apis category
    expect(plan.summary.create).toBe(1); // "New Section"
  });
});
