"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./Icon";
import { useCurrentUser } from "./CurrentUserProvider";
import { canCreateArticles, canManageImages, isTechWriter } from "@/lib/permissions";

/**
 * Quick-create shortcut — a "+ New" button that lives in the page header next
 * to the title, so creating content is one click away on every page. Actions
 * are role-gated; renders nothing for roles that can't create anything (e.g.
 * contributors). Reuses the sidebar create-menu dropdown styles.
 */
export default function QuickCreate() {
  const router = useRouter();
  const { role, loaded } = useCurrentUser();
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

  if (!loaded) return null;

  const actions = [
    { label: "New article", icon: "note-pencil", href: "/articles/new", show: canCreateArticles(role) },
    { label: "New snippet", icon: "scissors", href: "/snippets", show: isTechWriter(role) },
    { label: "Upload image", icon: "image-square", href: "/images", show: canManageImages(role) },
  ].filter((a) => a.show);

  if (actions.length === 0) return null; // nothing this role can create

  const go = (href: string) => { setOpen(false); router.push(href); };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((p) => !p)}
        className="btn btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Create new…"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <Icon name="plus" size={14} weight="bold" />
        New
      </button>
      {open && (
        <div className="create-menu-dropdown" role="menu" style={{ right: "auto", left: 0 }}>
          {actions.map((a) => (
            <button
              key={a.href + a.label}
              role="menuitem"
              className="create-menu-item"
              onClick={() => go(a.href)}
              style={{ display: "flex", alignItems: "center", gap: 10 }}
            >
              <Icon name={a.icon} size={15} />
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
