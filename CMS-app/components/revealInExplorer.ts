/**
 * "Reveal in project explorer" — a small decoupled bridge. Any object surface
 * (editor header, image viewer, …) calls `revealInExplorer(...)`; the sidebar
 * tree (SidebarTree) listens for REVEAL_EVENT, expands to the object's location,
 * scrolls it into view and flashes it.
 */
export const REVEAL_EVENT = "cms-reveal-in-tree";

export type RevealTarget = {
  type: "article" | "snippet" | "image";
  /** Content-relative file path, e.g. "help/x.mdx", "snippets/a/b.html",
   *  "images/icons/logo.png" — matches the leaf's data-tree-id. */
  file: string;
};

export function revealInExplorer(target: RevealTarget): void {
  window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: target }));
}
