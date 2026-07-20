import { describe, it, expect } from "vitest";
import { flattenTocArticles, articlesInSections, mapSectionTree, removeArticleFromToc } from "./toc-walk";
import type { Toc, TocSection, TocArticle } from "./types";

/**
 * Guards the walk that every consumer relies on to answer "what are all the
 * articles?".
 *
 * Before this existed, each consumer hand-rolled the walk and they disagreed:
 * compile never recursed into subsections (so those articles were SILENTLY
 * MISSING from published output), while publish recursed exactly one level and
 * still marked them published. The TOC claimed an article had shipped that was
 * never rendered.
 *
 * The failure mode is silent — a missing article raises no error — so it can
 * only be caught by an assertion.
 */

const art = (slug: string): TocArticle => ({ title: slug, file: `${slug}.html`, slug });

const toc: Toc = {
  categories: [
    {
      name: "Help",
      slug: "help",
      description: "",
      sections: [
        {
          name: "Passport",
          slug: "passport",
          articles: [art("top-1")],
          subsections: [
            {
              name: "Nested",
              slug: "nested",
              articles: [art("depth-1")],
              subsections: [
                { name: "Deeper", slug: "deeper", articles: [art("depth-2")] },
              ],
            },
          ],
        },
        { name: "Empty", slug: "empty", articles: [] },
      ],
    },
  ],
  articles: [art("uncategorized")],
};

describe("removeArticleFromToc", () => {
  /**
   * A TOC entry pointing at a deleted article is a broken contract: compile
   * can't read the file, publish skips it silently, and the Zendesk sync can
   * never distinguish "deleted" from "unreadable" — so it would stay live in the
   * customer help centre forever. Deleting must remove the entry, at any depth.
   */
  it("removes an article nested two levels deep", () => {
    const { toc: next, removed } = removeArticleFromToc(toc, "depth-2.html");
    expect(removed).toBe(true);
    expect(flattenTocArticles(next).map((a) => a.slug)).not.toContain("depth-2");
    // everything else survives
    expect(flattenTocArticles(next).map((a) => a.slug).sort()).toEqual(["depth-1", "top-1", "uncategorized"]);
  });

  it("removes an article from the uncategorised bucket", () => {
    const { toc: next, removed } = removeArticleFromToc(toc, "uncategorized.html");
    expect(removed).toBe(true);
    expect(next.articles).toEqual([]);
    expect(flattenTocArticles(next).map((a) => a.slug)).not.toContain("uncategorized");
  });

  it("reports removed:false when the entry isn't there (no pointless write)", () => {
    const { removed } = removeArticleFromToc(toc, "never-existed.html");
    expect(removed).toBe(false);
  });

  it("does not mutate the original TOC", () => {
    const before = JSON.stringify(toc);
    removeArticleFromToc(toc, "depth-2.html");
    expect(JSON.stringify(toc)).toBe(before);
  });

  it("preserves section structure and sibling order", () => {
    const { toc: next } = removeArticleFromToc(toc, "top-1.html");
    const help = next.categories[0];
    expect(help.sections.map((s) => s.slug)).toEqual(["passport", "empty"]);
    expect(help.sections[0].subsections?.[0].slug).toBe("nested");
    expect(help.sections[0].articles).toEqual([]); // only top-1 went
  });
});

describe("flattenTocArticles", () => {
  it("finds articles in subsections at ANY depth (compile used to miss these entirely)", () => {
    const slugs = flattenTocArticles(toc).map((a) => a.slug);
    expect(slugs).toContain("depth-1"); // one level down
    expect(slugs).toContain("depth-2"); // two levels down — publish missed these
  });

  it("includes the uncategorised bucket by default", () => {
    // Publish treats standalone articles as publishable, so anything deciding
    // "what is the content set" must agree — compile's `all` path did not.
    expect(flattenTocArticles(toc).map((a) => a.slug)).toContain("uncategorized");
  });

  it("can exclude the uncategorised bucket when the caller means 'filed only'", () => {
    const slugs = flattenTocArticles(toc, { includeUncategorized: false }).map((a) => a.slug);
    expect(slugs).not.toContain("uncategorized");
    expect(slugs).toContain("depth-2"); // still recurses
  });

  it("returns every article exactly once", () => {
    const slugs = flattenTocArticles(toc).map((a) => a.slug);
    expect(slugs.sort()).toEqual(["depth-1", "depth-2", "top-1", "uncategorized"]);
    expect(new Set(slugs).size).toBe(slugs.length); // no duplicates
  });

  it("tolerates an empty / malformed tree without throwing", () => {
    expect(flattenTocArticles({ categories: [] })).toEqual([]);
    // sections/articles absent entirely
    const sparse = { categories: [{ name: "X", slug: "x", description: "" }] } as unknown as Toc;
    expect(flattenTocArticles(sparse)).toEqual([]);
  });
});

describe("articlesInSections", () => {
  it("walks a section subtree to any depth", () => {
    const secs = toc.categories[0].sections;
    expect(articlesInSections(secs).map((a) => a.slug)).toEqual(["top-1", "depth-1", "depth-2"]);
  });

  it("an empty section contributes nothing", () => {
    expect(articlesInSections([{ name: "E", slug: "e", articles: [] }])).toEqual([]);
  });
});

describe("mapSectionTree", () => {
  it("preserves nesting (compiled output must mirror the tree, not flatten it)", () => {
    type Node = { slug: string; children: Node[] };
    const tree = mapSectionTree<Node>(
      toc.categories[0].sections,
      (sec, children) => ({ slug: sec.slug, children })
    );
    expect(tree.map((n) => n.slug)).toEqual(["passport", "empty"]);
    expect(tree[0].children.map((n) => n.slug)).toEqual(["nested"]);
    expect(tree[0].children[0].children.map((n) => n.slug)).toEqual(["deeper"]);
    expect(tree[1].children).toEqual([]); // leaf
  });
});
