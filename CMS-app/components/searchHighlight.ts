"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Search deep-link helpers. A search result for a config object opens its
 * management page with `?highlight=<id>` (and `?scope=` for shared/project
 * pages). These hooks read those params client-side and flash the target row.
 */

/** Read `?highlight` / `?scope` from the URL once, after mount. Reading in an
 *  effect (not during render) keeps SSR/hydration stable — the params are a
 *  client-only enhancement. */
export function useHighlightParams(): { highlight: string | null; scope: string | null } {
  const [params, setParams] = useState<{ highlight: string | null; scope: string | null }>({
    highlight: null,
    scope: null,
  });
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setParams({ highlight: sp.get("highlight"), scope: sp.get("scope") });
  }, []);
  return params;
}

/**
 * Once `ready` (the page's data for the relevant scope has loaded), scroll the
 * element tagged `data-highlight-id={highlight}` into view and flash it. Runs
 * at most once per highlight value; no-ops if the element isn't found (stale
 * target, or a page that opens the object a different way).
 */
export function useFlashHighlight(highlight: string | null, ready: boolean): void {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !highlight || done.current === highlight) return;
    // Defer a tick so freshly-rendered rows are in the DOM. setTimeout (not
    // requestAnimationFrame, which is paused on hidden/background tabs) so the
    // highlight still lands if the page isn't focused when it loads.
    const timer = window.setTimeout(() => {
      const sel = `[data-highlight-id="${highlight.replace(/["\\]/g, "\\$&")}"]`;
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return;
      done.current = highlight;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("search-highlight-flash");
      window.setTimeout(() => el.classList.remove("search-highlight-flash"), 2200);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [highlight, ready]);
}
