"use client";

import Icon from "./Icon";

/**
 * Global search entry point — an icon-only header button that opens the
 * non-modal search panel (same `cms-open-search` event as ⌘K). Lives in the
 * header on every page so search is always one click away.
 */
export default function SearchButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("cms-open-search"))}
      className="btn btn-icon"
      title="Search (⌘K)"
      aria-label="Search"
    >
      <Icon name="magnifying-glass" size={16} />
    </button>
  );
}
