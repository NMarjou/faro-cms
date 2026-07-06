import type { ReactNode } from "react";
import QuickCreate from "./QuickCreate";
import SearchButton from "./SearchButton";

/**
 * Shared page header — the top bar every page renders. The title sits on the
 * left next to the global quick-create ("+ New") shortcut; page-specific
 * actions go on the right via `children`, followed by the global search button.
 *
 *   <PageHeader title="Snippets">
 *     <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
 *       …page actions…
 *     </div>
 *   </PageHeader>
 *
 * `children` (the page's existing right-side actions block) is rendered on the
 * right, with the search icon pinned to the far-right corner.
 * `quickCreate={false}` opts a page out of the "+ New" shortcut.
 */
export default function PageHeader({
  title,
  children,
  quickCreate = true,
}: {
  title: ReactNode;
  children?: ReactNode;
  quickCreate?: boolean;
}) {
  return (
    <header className="main-header">
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {typeof title === "string" ? <h1>{title}</h1> : title}
        {quickCreate && <QuickCreate />}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {children}
        <SearchButton />
      </div>
    </header>
  );
}
