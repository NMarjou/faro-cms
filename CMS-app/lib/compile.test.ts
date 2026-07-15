import { describe, it, expect, vi } from "vitest";

// compile.ts imports ./content, which reaches storage. Stub it so the compile
// functions can be exercised directly.
vi.mock("./content", () => ({
  getSnippet: vi.fn(),
  getVariables: vi.fn(),
}));

import { getSnippet, getVariables } from "./content";
import {
  resolveConditionals,
  resolveVariables,
  resolveSnippets,
  compileArticle,
} from "./compile";

/**
 * Guards the highest-consequence code in the system: compile decides what
 * reaches PUBLISHED output. Conditional filtering shipped broken and silently —
 * gated content (e.g. admin-only) went to every audience, with no error raised.
 * A regression here can only be caught by an assertion, hence these tests.
 *
 * The markup below is copied from real content, not idealised: the editor writes
 * `data-tags` HTML-ESCAPED and double-quoted, and wraps conditional blocks around
 * NESTED <div>s. Both details are exactly what the original implementation got
 * wrong, so the fixtures must keep them.
 */

/** A conditional block as the editor actually writes it: escaped tags, a
 *  contenteditable label chip, and a nested content div. */
const conditionalBlock = (tag: string, body: string) =>
  `<div data-tags="[&quot;${tag}&quot;]" data-node-type="conditional" style="border-width: 2px;">` +
    `<div contenteditable="false" style="position: absolute;">⚡ ${tag}` +
      `<span data-action="remove-conditional-block" title="Remove condition (keep content)">×</span>` +
    `</div>` +
    `<div style="margin-top: 4px;">${body}</div>` +
  `</div>`;

/** An inline conditional mark as the editor writes it. */
const conditionalInline = (tag: string, text: string) =>
  `<span data-tags="[&quot;${tag}&quot;]" data-mark-type="conditional" title="Condition: ${tag}">${text}</span>`;

describe("resolveConditionals", () => {
  const secret = "<h2>Advanced: Custom Claims</h2><p>attribute mapping editor</p>";

  it("STRIPS a block whose tags don't match the audience (the leak that shipped)", () => {
    const html = `<p>intro</p>${conditionalBlock("advanced", secret)}<p>outro</p>`;
    const out = resolveConditionals(html, ["passport"]);

    expect(out).not.toContain("Custom Claims");
    expect(out).not.toContain("attribute mapping editor");
    // surrounding content must survive
    expect(out).toContain("intro");
    expect(out).toContain("outro");
  });

  it("KEEPS a block whose tags match the audience", () => {
    const html = conditionalBlock("advanced", secret);
    const out = resolveConditionals(html, ["advanced"]);
    expect(out).toContain("Custom Claims");
  });

  it("parses HTML-ESCAPED data-tags — JSON.parse used to throw and fall back to KEEPING", () => {
    // If entities aren't decoded, tags are unreadable and the content leaks.
    const html = conditionalBlock("admin-only", "<p>internal pricing</p>");
    expect(resolveConditionals(html, ["passport"])).not.toContain("internal pricing");
    expect(resolveConditionals(html, ["admin-only"])).toContain("internal pricing");
  });

  it("also accepts single-quoted data-tags", () => {
    const html = `<div data-tags='["advanced"]' data-node-type="conditional"><p>secret</p></div>`;
    expect(resolveConditionals(html, ["passport"])).not.toContain("secret");
    expect(resolveConditionals(html, ["advanced"])).toContain("secret");
  });

  it("finds the block's TRUE closing tag despite nested <div>s", () => {
    // A non-greedy regex stops at the FIRST </div> — the label chip's — leaving
    // the gated content orphaned in the output. Depth counting must handle this.
    const html = `${conditionalBlock("advanced", `<div><div>${"deeply nested secret"}</div></div>`)}<p>after</p>`;
    const out = resolveConditionals(html, ["passport"]);
    expect(out).not.toContain("deeply nested secret");
    expect(out).toContain("after"); // and must not swallow what follows
  });

  it("never leaks the editor's label chip into published output", () => {
    const kept = resolveConditionals(conditionalBlock("advanced", secret), ["advanced"]);
    expect(kept).toContain("Custom Claims");
    expect(kept).not.toContain("remove-conditional-block");
    expect(kept).not.toContain("contenteditable");
  });

  it("KEEPS a video embed inside a kept conditional block (chrome ≠ content)", () => {
    // Regression: stripConditionalChrome keyed on contenteditable="false" alone,
    // but VideoEmbed carries it too and compile never resolves it — so any video
    // inside a conditional block was silently deleted from published output.
    const video =
      `<div data-node-type="video" style="position: relative;" contenteditable="false">` +
        `<iframe src="https://www.youtube.com/embed/abc123" allowfullscreen></iframe>` +
      `</div>`;
    const html = conditionalBlock("advanced", `<p>watch this</p>${video}`);

    const kept = resolveConditionals(html, ["advanced"]);
    expect(kept).toContain("youtube.com/embed/abc123"); // the embed survives
    expect(kept).toContain('data-node-type="video"');
    expect(kept).not.toContain("remove-conditional-block"); // but the chip is gone
    expect(kept).not.toContain("⚡");

    // And it survives the no-audience path too (which also unwraps the chrome).
    const all = resolveConditionals(html, undefined);
    expect(all).toContain("youtube.com/embed/abc123");
    expect(all).not.toContain("⚡");
  });

  it("strips the label chip even WITHOUT the × control (older content)", () => {
    // Real content renders the chip as a bare contenteditable div with no remove
    // button. Keying the strip on `remove-conditional-block` left "⚡ workbench"
    // visible on the published page.
    const noRemoveBtn =
      `<div data-tags="[&quot;workbench&quot;]" data-node-type="conditional" style="position: relative;">` +
        `<div contenteditable="false" style="position: absolute;">⚡ workbench</div>` +
        `<div style="margin-top: 4px;"><p>body</p></div>` +
      `</div>`;
    const out = resolveConditionals(noRemoveBtn, ["workbench"]);
    expect(out).toContain("body");
    expect(out).not.toContain("⚡");
    expect(out).not.toContain("contenteditable");
  });

  it("STRIPS / KEEPS inline conditional marks by audience", () => {
    const html = `<p>Get a token from${conditionalInline("planner", " the admin panel.")}</p>`;
    expect(resolveConditionals(html, ["advanced"])).not.toContain("the admin panel");
    expect(resolveConditionals(html, ["planner"])).toContain("the admin panel");
    // the surrounding sentence survives either way
    expect(resolveConditionals(html, ["advanced"])).toContain("Get a token from");
  });

  it("keeps everything when no audience is selected", () => {
    const html = conditionalBlock("admin-only", secret);
    expect(resolveConditionals(html, undefined)).toContain("Custom Claims");
    expect(resolveConditionals(html, [])).toContain("Custom Claims");
  });

  it("STILL unwraps the markup with no audience — keeping content ≠ leaving markup", () => {
    // This shipped raw conditional wrappers and the editor's "⚡ advanced ×" chip
    // into published pages: the no-audience path returned the content untouched.
    // Invisible while compile output stayed inside the CMS; visible to readers
    // the moment it's published.
    for (const audience of [undefined, [] as string[]]) {
      const out = resolveConditionals(conditionalBlock("advanced", secret), audience);
      expect(out).toContain("Custom Claims"); // content kept
      expect(out).not.toContain("data-node-type=\"conditional\""); // wrapper gone
      expect(out).not.toContain("remove-conditional-block"); // editor chrome gone
      expect(out).not.toContain("contenteditable");
    }
  });

  it("STILL unwraps inline conditional marks with no audience", () => {
    const html = `<p>Get a token from${conditionalInline("planner", " the admin panel.")}</p>`;
    const out = resolveConditionals(html, undefined);
    expect(out).toContain("the admin panel"); // content kept
    expect(out).not.toContain("data-mark-type"); // wrapper gone
  });

  it("handles several blocks with different tags independently", () => {
    const html =
      conditionalBlock("advanced", "<p>ADV</p>") +
      conditionalBlock("passport", "<p>PASS</p>") +
      "<p>always</p>";
    const out = resolveConditionals(html, ["passport"]);
    expect(out).not.toContain("ADV");
    expect(out).toContain("PASS");
    expect(out).toContain("always");
  });

  it("resolves NESTED conditional blocks (a gated block inside a gated block)", () => {
    // Unwrapping the outer block and returning its inner content verbatim left
    // the INNER wrapper and its editor chrome in the published page.
    const nested = conditionalBlock("workbench", `<p>outer</p>${conditionalBlock("admin-only", "<p>inner</p>")}`);

    // no audience → keep both, but no markup survives
    const all = resolveConditionals(nested, undefined);
    expect(all).toContain("outer");
    expect(all).toContain("inner");
    expect(all).not.toContain("data-node-type=\"conditional\"");
    expect(all).not.toContain("remove-conditional-block");

    // audience matches only the OUTER tag → inner gated block is stripped
    const outerOnly = resolveConditionals(nested, ["workbench"]);
    expect(outerOnly).toContain("outer");
    expect(outerOnly).not.toContain("inner");
    expect(outerOnly).not.toContain("data-node-type=\"conditional\"");

    // audience matches neither → the whole thing goes
    const none = resolveConditionals(nested, ["passport"]);
    expect(none).not.toContain("outer");
    expect(none).not.toContain("inner");
  });

  it("keeps content when tags are unreadable (guard: don't silently delete)", () => {
    const html = `<div data-tags="not-json" data-node-type="conditional"><p>body</p></div>`;
    expect(resolveConditionals(html, ["passport"])).toContain("body");
  });
});

describe("resolveVariables", () => {
  const variable = (name: string) =>
    `<span data-variable="${name}" data-node-type="variable" contenteditable="false">{${name}}</span>`;

  it("replaces a known variable with its value", () => {
    const out = resolveVariables(`<p>${variable("productName")} rocks</p>`, { productName: "beqom" });
    expect(out).toBe("<p>beqom rocks</p>");
  });

  it("leaves {name} in place for an unknown variable", () => {
    const out = resolveVariables(`<p>${variable("missing")}</p>`, {});
    expect(out).toBe("<p>{missing}</p>");
  });

  it("tolerates either attribute order", () => {
    const reversed = `<span data-node-type="variable" data-variable="x" contenteditable="false">{x}</span>`;
    expect(resolveVariables(reversed, { x: "V" })).toBe("V");
  });
});

describe("resolveSnippets", () => {
  const snippetRef = (name: string) =>
    `<div data-node-type="snippet" data-snippet="${name}" contenteditable="false">placeholder</div>`;

  it("inlines the snippet body and reports which were used", async () => {
    vi.mocked(getSnippet).mockResolvedValue({
      name: "warn", file: "snippets/warn.html", content: "<p>Careful!</p>",
    });
    const { resolved, snippets } = await resolveSnippets(`<p>a</p>${snippetRef("warn")}`);
    expect(resolved).toBe("<p>a</p><p>Careful!</p>");
    expect(snippets).toEqual(["warn"]);
  });

  it("emits a comment (not a crash) when the snippet is missing", async () => {
    // Throw from the implementation rather than mockRejectedValue, which builds
    // the rejected promise eagerly and trips vitest's unhandled-rejection check.
    vi.mocked(getSnippet).mockImplementation(async () => {
      throw new Error("not found");
    });
    const { resolved } = await resolveSnippets(snippetRef("ghost"));
    expect(resolved).toBe("<!-- snippet not found: ghost -->");
  });
});

describe("compileArticle (end to end)", () => {
  it("resolves snippets, then variables, then conditionals — in that order", async () => {
    // The snippet body itself contains a variable and a gated block, so this
    // also proves snippets are expanded BEFORE the other passes run.
    vi.mocked(getVariables).mockResolvedValue({ productName: "beqom" });
    vi.mocked(getSnippet).mockResolvedValue({
      name: "s",
      file: "snippets/s.html",
      content:
        `<p><span data-variable="productName" data-node-type="variable">{productName}</span></p>` +
        conditionalBlock("admin-only", "<p>internal</p>"),
    });

    const { html, snippets } = await compileArticle(
      `<div data-node-type="snippet" data-snippet="s" contenteditable="false">x</div>`,
      undefined,
      undefined,
      ["passport"]
    );

    expect(snippets).toEqual(["s"]);
    expect(html).toContain("beqom");         // variable resolved inside the snippet
    expect(html).not.toContain("internal");  // gated block stripped inside the snippet
    expect(html).not.toContain("{productName}");
  });
});
