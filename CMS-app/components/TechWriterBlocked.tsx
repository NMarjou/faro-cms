"use client";

/**
 * Fallback page body shown to contributors who navigate directly to a
 * tech-writer-only route. Mirrors the existing pattern in `app/review/page.tsx`
 * — friendly inline message instead of a hard redirect, since the sidebar
 * already hides these links and direct-URL access is rare.
 */
export default function TechWriterBlocked({ title }: { title: string }) {
  return (
    <>
      <header className="main-header">
        <h1>{title}</h1>
      </header>
      <div className="main-body">
        <div
          className="card"
          style={{ maxWidth: 600, color: "var(--fg-muted)" }}
        >
          This area is available to tech writers only.
        </div>
      </div>
    </>
  );
}
