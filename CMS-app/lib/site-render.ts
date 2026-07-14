import type { SiteBundle, NavCategory, NavNode, SitePage } from "./site-bundle";

/**
 * Render a SiteBundle into the files of a static site.
 *
 * Deliberately dependency-free and self-contained: the output is plain HTML +
 * one stylesheet + the copied assets, so it can be served by anything (Vercel
 * staging today; the same bundle feeds the Zendesk sync later).
 */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Depth of a page below the site root — pages are nested, so relative links
 *  would be fragile. Everything is root-relative instead. */
function navHtml(nav: NavCategory[], currentPath: string): string {
  const node = (n: NavNode): string => {
    const pages = n.pages
      .map(
        (p) =>
          `<li><a class="${p.path === currentPath ? "active" : ""}" href="/${esc(p.path)}">${esc(p.title)}</a></li>`
      )
      .join("");
    const kids = n.children.map(node).join("");
    if (!pages && !kids) return "";
    return `<li class="sec"><span>${esc(n.name)}</span><ul>${pages}${kids}</ul></li>`;
  };
  return nav
    .map(
      (cat) =>
        `<div class="cat"><h2>${esc(cat.name)}</h2>` +
        (cat.description ? `<p class="cat-desc">${esc(cat.description)}</p>` : "") +
        `<ul>${cat.sections.map(node).join("")}</ul></div>`
    )
    .join("");
}

function shell(opts: {
  title: string;
  description?: string;
  keywords?: string[];
  nav: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
${opts.description ? `<meta name="description" content="${esc(opts.description)}">\n` : ""}${
    opts.keywords?.length ? `<meta name="keywords" content="${esc(opts.keywords.join(", "))}">\n` : ""
  }<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="layout">
  <aside class="nav"><a class="brand" href="/">Documentation</a>${opts.nav}</aside>
  <main class="content">${opts.body}</main>
</div>
</body>
</html>
`;
}

function pageHtml(page: SitePage, bundle: SiteBundle): string {
  const crumbs = page.trail.length
    ? `<nav class="crumbs">${page.trail.map(esc).join(" › ")}</nav>`
    : "";
  const body =
    crumbs +
    `<h1>${esc(page.title)}</h1>` +
    (page.summary ? `<p class="summary">${esc(page.summary)}</p>` : "") +
    `<article>${page.html}</article>`;
  return shell({
    title: page.title,
    description: page.summary,
    keywords: page.keywords,
    nav: navHtml(bundle.nav, page.path),
    body,
  });
}

function indexHtml(bundle: SiteBundle): string {
  const cards = bundle.nav
    .map(
      (cat) =>
        `<section class="card"><h2>${esc(cat.name)}</h2>` +
        (cat.description ? `<p>${esc(cat.description)}</p>` : "") +
        `</section>`
    )
    .join("");
  return shell({
    title: "Documentation",
    nav: navHtml(bundle.nav, ""),
    body: `<h1>Documentation</h1><div class="cards">${cards}</div>`,
  });
}

/** The site stylesheet. `contentCss` is the CMS's own content styles (the
 *  classes authors apply), appended so published pages look like the editor. */
function styleSheet(contentCss: string): string {
  // Callouts (messageBox) are authored content and survive into the output, but
  // their inline styles reference the CMS's colour tokens — var(--info-light),
  // var(--warning) and friends. Without these definitions every callout renders
  // with no background and no border: silently unstyled, not obviously broken.
  return `:root{--fg:#1c2a3d;--muted:#64748b;--border:#e2e8f0;--bg:#fff;--accent:#1e3a8a;--code:#f1f5f9;
--info:#2563eb;--info-light:#eff6ff;--warning:#b45309;--warning-light:#fffbeb;
--success:#15803d;--success-light:#f0fdf4;--danger:#b91c1c;--danger-light:#fef2f2;--highlight:#7c3aed}
[data-node-type="messageBox"]{margin:16px 0}
[data-node-type="messageBox"]>div:first-child{font-weight:600;font-size:13px;margin-bottom:4px}
*{box-sizing:border-box}
body{margin:0;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg)}
.layout{display:flex;min-height:100vh}
.nav{width:280px;flex:0 0 280px;border-right:1px solid var(--border);padding:24px 20px;overflow-y:auto}
.brand{display:block;font-weight:700;margin-bottom:20px;color:var(--fg);text-decoration:none}
.nav h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:20px 0 6px}
.cat-desc{font-size:12px;color:var(--muted);margin:0 0 8px}
.nav ul{list-style:none;margin:0;padding:0}
.nav .sec>span{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}
.nav .sec ul{padding-left:12px;border-left:1px solid var(--border)}
.nav a{display:block;padding:3px 0;font-size:14px;color:var(--muted);text-decoration:none}
.nav a:hover{color:var(--fg)}
.nav a.active{color:var(--accent);font-weight:600}
.content{flex:1;padding:40px 48px;max-width:820px}
.crumbs{font-size:13px;color:var(--muted);margin-bottom:8px}
.summary{font-size:17px;color:var(--muted);margin-top:-4px}
h1{font-size:32px;line-height:1.25;margin:0 0 12px}
h2{font-size:22px;margin:28px 0 8px}
h3{font-size:18px;margin:22px 0 6px}
img{max-width:100%;height:auto}
table{border-collapse:collapse;width:100%;margin:16px 0}
th,td{border:1px solid var(--border);padding:8px 10px;text-align:left}
th{background:var(--code)}
pre{background:var(--code);padding:12px 14px;border-radius:6px;overflow-x:auto}
code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:.9em}
a{color:var(--accent)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;margin-top:24px}
.card{border:1px solid var(--border);border-radius:10px;padding:18px}
.card h2{margin:0 0 6px;font-size:18px}
.card p{margin:0;color:var(--muted);font-size:14px}

/* ── Content styles from the CMS ── */
${contentCss}
`;
}

/** Every text file of the built site, keyed by output path. Assets are copied
 *  separately (they're binary). */
export function renderSite(bundle: SiteBundle, contentCss = ""): Map<string, string> {
  const files = new Map<string, string>();
  files.set("index.html", indexHtml(bundle));
  files.set("styles.css", styleSheet(contentCss));
  for (const page of bundle.pages) files.set(page.path, pageHtml(page, bundle));
  return files;
}
