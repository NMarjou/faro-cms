"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./Icon";
import { useCurrentUser } from "./CurrentUserProvider";
import { canCreateArticles, canManageImages, isTechWriter } from "@/lib/permissions";

/**
 * Global quick-create shortcut — a floating action button fixed to the
 * bottom-right on every page, so creating content is always one click away
 * (the sidebar's create menu is tech-writer-only and hides when the sidebar
 * collapses). Actions are role-gated; the FAB hides entirely for roles that
 * can't create anything (e.g. contributors).
 */
export default function QuickCreate() {
  const router = useRouter();
  const { role, loaded } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
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

  if (!loaded) return null;

  const actions = [
    { label: "New article", icon: "note-pencil", href: "/articles/new", show: canCreateArticles(role) },
    { label: "New snippet", icon: "scissors", href: "/snippets", show: isTechWriter(role) },
    { label: "Upload image", icon: "image-square", href: "/images", show: canManageImages(role) },
  ].filter((a) => a.show);

  if (actions.length === 0) return null; // nothing this role can create

  const go = (href: string) => { setOpen(false); router.push(href); };

  return (
    <div
      ref={ref}
      style={{ position: "fixed", right: 24, bottom: 24, zIndex: 90, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}
    >
      {open && (
        <div
          role="menu"
          style={{
            display: "flex", flexDirection: "column", gap: 6,
            background: "var(--bg-elevated, var(--bg))",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
            minWidth: 180,
          }}
        >
          {actions.map((a) => (
            <button
              key={a.href + a.label}
              role="menuitem"
              onClick={() => go(a.href)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: "calc(var(--radius) - 2px)",
                border: "none", background: "none", cursor: "pointer",
                color: "var(--fg)", fontSize: 14, fontFamily: "inherit", textAlign: "left", width: "100%",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover, var(--border))")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <Icon name={a.icon} size={16} />
              {a.label}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen((p) => !p)}
        aria-label="Create new"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Create new…"
        style={{
          width: 52, height: 52, borderRadius: "50%",
          background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 6px 18px rgba(0,0,0,0.22)",
          transition: "transform 0.15s ease",
          transform: open ? "rotate(45deg)" : "none",
        }}
      >
        <Icon name="plus" size={24} weight="bold" />
      </button>
    </div>
  );
}
