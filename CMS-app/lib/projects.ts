/**
 * Project manifest access (CMS-content/projects.json). projects.json is a
 * platform path (project-independent), so these reads don't depend on the
 * current request's project.
 */

import { getFile } from "./storage";
import { DEFAULT_PROJECT_SLUG } from "./content-paths";
import type { Project, ProjectsData } from "./types";

export const PROJECTS_PATH = "content/projects.json";

const FALLBACK: Project[] = [
  { slug: DEFAULT_PROJECT_SLUG, name: "Accelerate", default: true },
];

export async function loadProjects(): Promise<Project[]> {
  try {
    const file = await getFile(PROJECTS_PATH);
    const data = JSON.parse(file.content) as ProjectsData;
    return Array.isArray(data.projects) && data.projects.length > 0
      ? data.projects
      : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export async function projectExists(slug: string): Promise<boolean> {
  return (await loadProjects()).some((p) => p.slug === slug);
}

export async function defaultProjectSlug(): Promise<string> {
  const projects = await loadProjects();
  return (projects.find((p) => p.default) || projects[0])?.slug || DEFAULT_PROJECT_SLUG;
}

/** Normalize a name into a url/path-safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
