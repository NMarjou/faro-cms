import { describe, it, expect } from "vitest";
import {
  buildSyncPlan,
  executeSync,
  hashArticle,
  articlesWithSectionPaths,
  planFromMap,
  type ZendeskWriter,
  type SyncArticle,
  type SyncDeps,
} from "./zendesk-sync";
import { rewriteAssetUrls } from "./site-bundle";
import { emptyMap, type ZendeskMap } from "./zendesk-map";
import type { ReconcilePlan, ReconcileNode } from "./zendesk-reconcile";

/**
 * The outbound sync writes to a LIVE customer help centre with no undo, so its
 * contract is asserted, not assumed: create in dependency order, write every id
 * back to the map immediately (idempotency), publish unchanged articles never.
 * The real Zendesk wire calls can't run without a token — a mock writer stands
 * in so the orchestration itself is fully covered.
 */

// ── builders ─────────────────────────────────────────────────────────────────

const catNode = (key: string, name: string, status: ReconcileNode["status"], children: ReconcileNode[] = [], zendeskId?: number): ReconcileNode =>
  ({ kind: "category", faroKey: key, name, status, zendeskId, children });
const secNode = (key: string, name: string, status: ReconcileNode["status"], children: ReconcileNode[] = [], zendeskId?: number): ReconcileNode =>
  ({ kind: "section", faroKey: key, name, status, zendeskId, children });
const plan = (nodes: ReconcileNode[]): ReconcilePlan =>
  ({ nodes, orphans: { categories: [], sections: [] }, summary: { linked: 0, matched: 0, ambiguous: 0, create: 0, stale: 0 } });

// A mock writer with deterministic ids (no Date/random) that records its calls.
function mockWriter() {
  let cat = 1000, sec = 2000, art = 3000;
  const calls = {
    createCategory: [] as string[],
    createSection: [] as { name: string; categoryId: number; parentSectionId: number | null }[],
    createArticle: [] as { sectionId: number; title: string; body: string }[],
    updateArticle: [] as { id: number; title: string; body: string }[],
    uploadAttachment: [] as string[],
  };
  const writer: ZendeskWriter = {
    async createCategory(name) { calls.createCategory.push(name); return ++cat; },
    async createSection(name, categoryId, parentSectionId) { calls.createSection.push({ name, categoryId, parentSectionId }); return ++sec; },
    async createArticle(sectionId, a) { calls.createArticle.push({ sectionId, ...a }); const id = ++art; return { id, url: `https://z/hc/articles/${id}` }; },
    async updateArticle(id, a) { calls.updateArticle.push({ id, ...a }); return { id, url: `https://z/hc/articles/${id}` }; },
    async uploadAttachment(fileName) { calls.uploadAttachment.push(fileName); return { contentUrl: `https://z/attachments/${fileName}` }; },
  };
  return { writer, calls };
}

function deps(writer: ZendeskWriter, persisted: ZendeskMap[]): SyncDeps {
  return {
    writer,
    loadBytes: async () => Buffer.from("bytes"),
    persist: async (m) => { persisted.push(JSON.parse(JSON.stringify(m))); },
    rewriteAssets: (body, toUrl) => rewriteAssetUrls(body, toUrl),
  };
}

const art = (over: Partial<SyncArticle> = {}): SyncArticle => ({
  file: "help/passport/getting-started.html",
  title: "Getting Started",
  sectionPath: "help/passport",
  body: "<p>hello</p>",
  assets: [],
  hash: hashArticle("Getting Started", "<p>hello</p>"),
  ...over,
});

// ── planner ──────────────────────────────────────────────────────────────────

describe("buildSyncPlan", () => {
  it("classifies articles new / changed / unchanged against the map", () => {
    const map: ZendeskMap = {
      ...emptyMap(),
      categories: { help: 500 }, sections: { "help/passport": 700 },
      articles: { "help/passport/a.html": { id: 10, hash: "OLD" }, "help/passport/b.html": { id: 11, hash: hashArticle("B", "<p>b</p>") } },
    };
    const p = plan([catNode("help", "Help", "linked", [secNode("help/passport", "Passport", "linked", [], 700)], 500)]);
    const articles = [
      { file: "help/passport/new.html", title: "New", sectionPath: "help/passport", hash: "H1" },
      { file: "help/passport/a.html", title: "A", sectionPath: "help/passport", hash: "H2" }, // hash differs → update
      { file: "help/passport/b.html", title: "B", sectionPath: "help/passport", hash: hashArticle("B", "<p>b</p>") }, // same → skip
    ];
    const sp = buildSyncPlan(p, map, articles, []);
    expect(sp.summary.articlesCreate).toBe(1);
    expect(sp.summary.articlesUpdate).toBe(1);
    expect(sp.summary.articlesSkip).toBe(1);
    expect(sp.ready).toBe(true);
  });

  it("is NOT ready while a structural match is unconfirmed", () => {
    const p = plan([catNode("help", "Help", "matched", [], 500)]);
    const sp = buildSyncPlan(p, emptyMap(), [], []);
    expect(sp.ready).toBe(false);
    expect(sp.unconfirmed).toEqual([{ key: "help", name: "Help", status: "matched" }]);
  });

  it("blocks unfiled articles and articles whose section isn't syncing", () => {
    const p = plan([catNode("help", "Help", "linked", [secNode("help/passport", "Passport", "linked", [], 700)], 500)]);
    const articles = [
      art({ file: "orphan.html", sectionPath: "" }),
      art({ file: "help/ghost/x.html", sectionPath: "help/ghost" }), // section not in the plan
    ];
    const sp = buildSyncPlan(p, emptyMap(), articles, ["standalone.html"]);
    const reasons = sp.blocked.map((b) => b.file);
    expect(reasons).toContain("standalone.html");
    expect(reasons).toContain("help/ghost/x.html");
    expect(sp.summary.blocked).toBe(sp.blocked.length);
  });

  it("plans creates for new structure", () => {
    const p = plan([catNode("apis", "APIs", "create", [secNode("apis/hub", "Hub", "create")])]);
    const sp = buildSyncPlan(p, emptyMap(), [], []);
    expect(sp.summary.categoriesCreate).toBe(1);
    expect(sp.summary.sectionsCreate).toBe(1);
    expect(sp.ops.find((o) => o.key === "apis/hub")?.parentKey).toBe("apis");
  });
});

// ── executor ─────────────────────────────────────────────────────────────────

describe("executeSync", () => {
  it("creates category then section then article, in order, publishing live", async () => {
    const { writer, calls } = mockWriter();
    const persisted: ZendeskMap[] = [];
    const map = emptyMap();
    const p = plan([catNode("apis", "APIs", "create", [secNode("apis/hub", "Hub", "create")])]);
    const report = await executeSync({
      plan: p, map,
      articles: [art({ file: "apis/hub/intro.html", title: "Intro", sectionPath: "apis/hub", body: "<p>intro</p>" })],
      deps: deps(writer, persisted),
    });
    expect(report.categoriesCreated).toBe(1);
    expect(report.sectionsCreated).toBe(1);
    expect(report.articlesCreated).toBe(1);
    // section was created under the freshly-created category's id
    expect(calls.createSection[0].categoryId).toBe(map.categories["apis"]);
    // article created under the freshly-created section's id
    expect(calls.createArticle[0].sectionId).toBe(map.sections["apis/hub"]);
  });

  it("writes every created id back to the map and PERSISTS after each", async () => {
    const { writer } = mockWriter();
    const persisted: ZendeskMap[] = [];
    const map = emptyMap();
    const p = plan([catNode("apis", "APIs", "create", [secNode("apis/hub", "Hub", "create")])]);
    await executeSync({ plan: p, map, articles: [art({ file: "apis/hub/x.html", sectionPath: "apis/hub" })], deps: deps(writer, persisted) });
    // one persist after the category, one after the section, one after the article
    expect(persisted.length).toBe(3);
    expect(persisted[0].categories["apis"]).toBeDefined();       // category persisted first
    expect(persisted[1].sections["apis/hub"]).toBeDefined();     // then the section
    expect(persisted[2].articles["apis/hub/x.html"]).toBeDefined(); // then the article
    expect(map.articles["apis/hub/x.html"].id).toBe(3001);
  });

  it("skips an unchanged article — no create, no update, no upload", async () => {
    const { writer, calls } = mockWriter();
    const persisted: ZendeskMap[] = [];
    const h = hashArticle("Intro", "<p>i</p>");
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 }, sections: { "help/p": 700 }, articles: { "help/p/i.html": { id: 9, hash: h } } };
    const p = plan([catNode("help", "Help", "linked", [secNode("help/p", "P", "linked", [], 700)], 500)]);
    const report = await executeSync({
      plan: p, map,
      articles: [art({ file: "help/p/i.html", title: "Intro", sectionPath: "help/p", body: "<p>i</p>", hash: h })],
      deps: deps(writer, persisted),
    });
    expect(report.articlesSkipped).toBe(1);
    expect(calls.createArticle).toHaveLength(0);
    expect(calls.updateArticle).toHaveLength(0);
    expect(persisted).toHaveLength(0); // nothing changed → nothing persisted
  });

  it("updates a changed article by its mapped id", async () => {
    const { writer, calls } = mockWriter();
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 }, sections: { "help/p": 700 }, articles: { "help/p/i.html": { id: 42, hash: "OLD" } } };
    const p = plan([catNode("help", "Help", "linked", [secNode("help/p", "P", "linked", [], 700)], 500)]);
    const report = await executeSync({
      plan: p, map,
      articles: [art({ file: "help/p/i.html", title: "Intro", sectionPath: "help/p", body: "<p>changed</p>", hash: "NEW" })],
      deps: deps(writer, []),
    });
    expect(report.articlesUpdated).toBe(1);
    expect(calls.updateArticle[0].id).toBe(42);
    expect(map.articles["help/p/i.html"].hash).toBe("NEW");
  });

  it("uploads referenced images and rewrites the body to their content_url", async () => {
    const { writer, calls } = mockWriter();
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 }, sections: { "help/p": 700 } };
    const p = plan([catNode("help", "Help", "linked", [secNode("help/p", "P", "linked", [], 700)], 500)]);
    const body = `<p><img src="/api/content?path=images%2Ficons%2Fx.svg&amp;raw=1" alt="x"></p>`;
    await executeSync({
      plan: p, map,
      articles: [art({ file: "help/p/i.html", sectionPath: "help/p", body, assets: ["images/icons/x.svg"] })],
      deps: deps(writer, []),
    });
    expect(calls.uploadAttachment).toEqual(["x.svg"]);
    // the created article body points at the attachment url, not /api/content
    expect(calls.createArticle[0].body).toContain("https://z/attachments/x.svg");
    expect(calls.createArticle[0].body).not.toContain("/api/content");
  });

  it("REFUSES to run while a match is unconfirmed (would duplicate on create)", async () => {
    const { writer } = mockWriter();
    const p = plan([catNode("help", "Help", "matched", [], 500)]);
    await expect(
      executeSync({ plan: p, map: emptyMap(), articles: [], deps: deps(writer, []) })
    ).rejects.toThrow(/confirm/i);
  });

  it("records a per-article failure and continues with the rest", async () => {
    const { writer } = mockWriter();
    const failing: ZendeskWriter = {
      ...writer,
      createArticle: async (sectionId, a) => {
        if (a.title === "Boom") throw new Error("422 body invalid");
        return writer.createArticle(sectionId, a);
      },
    };
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 }, sections: { "help/p": 700 } };
    const p = plan([catNode("help", "Help", "linked", [secNode("help/p", "P", "linked", [], 700)], 500)]);
    const report = await executeSync({
      plan: p, map,
      articles: [
        art({ file: "help/p/ok.html", title: "OK", sectionPath: "help/p" }),
        art({ file: "help/p/bad.html", title: "Boom", sectionPath: "help/p" }),
      ],
      deps: deps(failing, []),
    });
    expect(report.articlesCreated).toBe(1); // the OK one still went
    expect(report.failures).toEqual([{ key: "help/p/bad.html", error: "422 body invalid" }]);
  });

  it("reports articles with internal cross-links (the un-rewritten gap)", async () => {
    const { writer } = mockWriter();
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 }, sections: { "help/p": 700 } };
    const p = plan([catNode("help", "Help", "linked", [secNode("help/p", "P", "linked", [], 700)], 500)]);
    const report = await executeSync({
      plan: p, map,
      articles: [art({ file: "help/p/i.html", sectionPath: "help/p", body: `<a href="other-article">see</a>` })],
      deps: deps(writer, []),
    });
    expect(report.internalLinks).toEqual([{ file: "help/p/i.html", count: 1 }]);
  });

  it("nests a subsection's section under its parent section id", async () => {
    const { writer, calls } = mockWriter();
    const map = emptyMap();
    const p = plan([
      catNode("help", "Help", "create", [
        secNode("help/p", "P", "create", [secNode("help/p/sub", "Sub", "create")]),
      ]),
    ]);
    await executeSync({ plan: p, map, articles: [], deps: deps(writer, []) });
    // two sections created: parent (parentSectionId null), then the subsection
    // nested under the parent's id.
    expect(calls.createSection).toHaveLength(2);
    expect(calls.createSection[0].parentSectionId).toBeNull();
    expect(calls.createSection[1].parentSectionId).toBe(map.sections["help/p"]);
  });
});

describe("planFromMap", () => {
  it("marks mapped nodes linked and unmapped ones create, without any Zendesk call", () => {
    const toc = {
      categories: [
        { slug: "help", name: "Help", description: "", sections: [
          { slug: "p", name: "P", articles: [] },        // mapped → linked
          { slug: "new", name: "New", articles: [] },    // unmapped → create
        ] },
        { slug: "apis", name: "APIs", description: "", sections: [] }, // unmapped → create
      ],
    };
    const map: ZendeskMap = { ...emptyMap(), categories: { help: 500 }, sections: { "help/p": 700 } };
    const rp = planFromMap(toc as any, map);
    expect(rp.nodes[0].status).toBe("linked");
    expect(rp.nodes[0].zendeskId).toBe(500);
    expect(rp.nodes[0].children[0].status).toBe("linked"); // help/p
    expect(rp.nodes[0].children[1].status).toBe("create"); // help/new
    expect(rp.nodes[1].status).toBe("create");             // apis
  });
});

describe("articlesWithSectionPaths", () => {
  it("yields each filed article with its slug path and separates the unfiled", () => {
    const toc = {
      categories: [
        { slug: "help", name: "Help", description: "", sections: [
          { slug: "p", name: "P", articles: [{ title: "A", file: "help/p/a.html", slug: "a" }], subsections: [
            { slug: "sub", name: "Sub", articles: [{ title: "B", file: "help/p/sub/b.html", slug: "b" }] },
          ] },
        ] },
      ],
      articles: [{ title: "Loose", file: "loose.html", slug: "loose" }],
    };
    const { filed, unfiled } = articlesWithSectionPaths(toc as any);
    expect(filed).toEqual([
      { file: "help/p/a.html", title: "A", sectionPath: "help/p" },
      { file: "help/p/sub/b.html", title: "B", sectionPath: "help/p/sub" },
    ]);
    expect(unfiled).toEqual(["loose.html"]);
  });
});
