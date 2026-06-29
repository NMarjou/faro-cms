"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import { PROJECT_STORAGE_KEY } from "./CurrentUserProvider";

/**
 * Active-project selection. Persists the chosen slug in
 * localStorage["cms-current-project"]; the fetch interceptor (CurrentUserProvider)
 * sends it as the `x-cms-project` header so the server scopes content to it.
 * Switching reloads so every project-scoped view (sidebar, dashboard, editor,
 * search) reflects the new project without per-view event wiring.
 */

interface CurrentProjectCtx {
  project: string | null;
  projects: Project[];
  loaded: boolean;
  setProject: (slug: string) => void;
}

const Ctx = createContext<CurrentProjectCtx>({
  project: null,
  projects: [],
  loaded: false,
  setProject: () => {},
});

export function CurrentProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProjectState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects?: Project[] }) => {
        if (cancelled) return;
        const list = d.projects || [];
        setProjects(list);
        let stored: string | null = null;
        try {
          stored = localStorage.getItem(PROJECT_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        const fallback = (list.find((p) => p.default) || list[0])?.slug || null;
        // Honor a stored selection only if it's still a real project.
        const active = stored && list.some((p) => p.slug === stored) ? stored : fallback;
        setProjectState(active);
        try {
          if (active) localStorage.setItem(PROJECT_STORAGE_KEY, active);
        } catch {
          /* ignore */
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setProject = useCallback((slug: string) => {
    try {
      localStorage.setItem(PROJECT_STORAGE_KEY, slug);
    } catch {
      /* ignore */
    }
    setProjectState(slug);
    window.dispatchEvent(new Event("cms-project-changed"));
    // Reload so all project-scoped views re-fetch under the new project.
    window.location.reload();
  }, []);

  return (
    <Ctx.Provider value={{ project, projects, loaded, setProject }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCurrentProject() {
  return useContext(Ctx);
}
