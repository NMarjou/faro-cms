"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrentProject } from "./CurrentProjectProvider";
import Icon from "./Icon";

/**
 * Project switcher — a custom, app-styled dropdown (not a native <select>, whose
 * option list can't be themed) that scopes all content to the selected project.
 */
export default function ProjectSwitcher() {
  const { project, projects, setProject } = useCurrentProject();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (projects.length === 0) return null;

  const current = projects.find((p) => p.slug === project);

  return (
    <div style={{ padding: "0 12px 8px" }}>
      <label style={{ fontSize: 11, color: "var(--fg-muted)", display: "block", marginBottom: 4 }}>
        Project
      </label>
      <div ref={ref} style={{ position: "relative" }}>
        <button
          type="button"
          className="input input-trigger"
          onClick={() => setOpen((p) => !p)}
          aria-haspopup="listbox"
          aria-expanded={open}
          title="Switch project"
          style={{
            width: "100%", fontSize: 13, cursor: "pointer", textAlign: "left",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {current?.name || "Select project"}
          </span>
          <Icon name="caret-down" size={12} style={{ flexShrink: 0, color: "var(--fg-muted)", transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "none" }} />
        </button>
        {open && (
          <div
            className="create-menu-dropdown"
            role="listbox"
            style={{ left: 0, right: 0, minWidth: 0, maxHeight: 280, overflowY: "auto" }}
          >
            {projects.map((p) => {
              const active = p.slug === project;
              return (
                <button
                  key={p.slug}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className="create-menu-item"
                  onClick={() => { setOpen(false); if (p.slug !== project) setProject(p.slug); }}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                    color: active ? "var(--accent)" : undefined,
                    fontWeight: active ? 600 : undefined,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  {active && <Icon name="check" size={13} style={{ flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
