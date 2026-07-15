import { describe, it, expect, vi } from "vitest";

// site-bundle reaches storage/content; only the pure rewriters are under test.
vi.mock("./content", () => ({ getToc: vi.fn(), getArticle: vi.fn() }));
vi.mock("./storage", () => ({ getFile: vi.fn() }));

import {
  rewriteAssetUrls,
  rewriteInternalLinks,
  outputPathFor,
  assetUrlFor,
  buildLinkResolver,
} from "./site-bundle";

/**
 * The two ways a published page silently breaks.
 *
 * compile() resolves snippets/variables/conditionals, but its HTML is still
 * CMS-internal: images point at `/api/content?…` (a URL that exists only inside
 * this app) and links are bare slugs. Publish that as-is and every image 404s
 * and every cross-link dead-ends — with no error anywhere.
 *
 * The fixtures below are the markup the editor ACTUALLY writes, entities and
 * all: `path=images%2Ficons%2Fx.svg&amp;raw=1` is URL-encoded inside an
 * HTML-escaped query, so both layers have to be undone. A tidied-up fixture
 * would pass against a broken implementation.
 */

describe("rewriteAssetUrls", () => {
  const real = `<img src="/api/content?path=images%2Ficons%2Ftest-circle.svg&amp;raw=1" alt="test-circle.svg">`;

  it("rewrites the CMS API url to a static path and reports the asset to copy", () => {
    const { html, assets } = rewriteAssetUrls(real);
    expect(html).toContain('src="/images/icons/test-circle.svg"');
    expect(html).not.toContain("/api/content"); // nothing CMS-internal survives
    expect(assets).toEqual(["images/icons/test-circle.svg"]);
  });

  it("undoes BOTH encodings — %2F in the path and &amp; in the query", () => {
    // If either layer is missed, the asset path is garbage and the copy fails.
    const { assets } = rewriteAssetUrls(real);
    expect(assets[0]).toBe("images/icons/test-circle.svg");
    expect(assets[0]).not.toContain("%2F");
  });

  it("collects each asset once, even when reused across the page", () => {
    const { assets } = rewriteAssetUrls(real + real);
    expect(assets).toEqual(["images/icons/test-circle.svg"]);
  });

  it("refuses a path-traversal asset instead of copying it out of the content root", () => {
    const evil = `<img src="/api/content?path=..%2F..%2F..%2Fetc%2Fpasswd&amp;raw=1">`;
    const { html, assets } = rewriteAssetUrls(evil);
    expect(assets).toEqual([]);          // nothing collected to copy
    expect(html).toBe(evil);             // src left untouched, not rewritten
  });

  it("leaves external and already-static images alone", () => {
    const html = `<img src="https://cdn.example.com/a.png"><img src="/images/b.png">`;
    const out = rewriteAssetUrls(html);
    expect(out.html).toBe(html);
    expect(out.assets).toEqual([]);
  });

  it("supports a custom url mapper (Zendesk will host assets elsewhere)", () => {
    const { html } = rewriteAssetUrls(real, (p) => `https://cdn.test/${p}`);
    expect(html).toContain('src="https://cdn.test/images/icons/test-circle.svg"');
  });
});

describe("rewriteInternalLinks", () => {
  const resolve = (slug: string) =>
    slug === "managing-goals" ? "/help/passport/managing-goals.html" : null;

  it("resolves a bare-slug link to its output path", () => {
    const real = `<a target="_blank" rel="noopener noreferrer nofollow" href="managing-goals">Goals</a>`;
    const { html, broken } = rewriteInternalLinks(real, resolve);
    expect(html).toContain('href="/help/passport/managing-goals.html"');
    expect(broken).toEqual([]);
  });

  it("REPORTS an unresolvable slug instead of leaving a silent dead link", () => {
    const { broken } = rewriteInternalLinks(`<a href="ghost-article">x</a>`, resolve);
    expect(broken).toEqual(["ghost-article"]);
  });

  it("preserves the #fragment on a resolved link (deep links must not reset to top)", () => {
    const real = `<a href="managing-goals#step-2">Goals</a>`;
    const { html } = rewriteInternalLinks(real, resolve);
    expect(html).toContain('href="/help/passport/managing-goals.html#step-2"');
  });

  it("never touches external, rooted, anchor or mailto links", () => {
    const html =
      `<a href="https://x.com">a</a><a href="/already/rooted.html">b</a>` +
      `<a href="#section">c</a><a href="mailto:x@y.z">d</a>`;
    const { html: out, broken } = rewriteInternalLinks(html, resolve);
    expect(out).toBe(html);
    expect(broken).toEqual([]);
  });
});

describe("buildLinkResolver", () => {
  // Cross-references are NOT written consistently. The editor inserts the
  // article's FILE PATH (Editor.tsx: `href: data.file`), while older content
  // uses a bare slug. Matching only one form would silently kill the rest —
  // every dead link renders fine and simply goes nowhere.
  const resolve = buildLinkResolver([
    { title: "Managing Goals", slug: "managing-goals-in-passport", file: "help/passport/managing-goals.html" },
  ]);
  const expected = "/help/passport/managing-goals.html";

  it("resolves the FILE PATH form the editor actually inserts", () => {
    expect(resolve("help/passport/managing-goals.html")).toBe(expected);
  });

  it("resolves a file path without its extension", () => {
    expect(resolve("help/passport/managing-goals")).toBe(expected);
  });

  it("resolves the TOC slug", () => {
    expect(resolve("managing-goals-in-passport")).toBe(expected);
  });

  it("resolves a bare basename (legacy hand-authored links)", () => {
    expect(resolve("managing-goals")).toBe(expected);
  });

  it("ignores query/hash when matching", () => {
    expect(resolve("help/passport/managing-goals.html#step-2")).toBe(expected);
  });

  it("returns null for an article that isn't in the TOC (a real dead link)", () => {
    expect(resolve("orphaned-article")).toBeNull();
  });
});

describe("path helpers", () => {
  it("maps an article to a .html output path", () => {
    expect(outputPathFor({ title: "T", slug: "s", file: "help/passport/getting-started.html" })).toBe(
      "help/passport/getting-started.html"
    );
    // legacy .mdx entries still land on .html
    expect(outputPathFor({ title: "T", slug: "s", file: "a/b.mdx" })).toBe("a/b.html");
  });

  it("asset urls are root-relative, so they resolve from any page depth", () => {
    expect(assetUrlFor("images/icons/x.svg")).toBe("/images/icons/x.svg");
  });
});
