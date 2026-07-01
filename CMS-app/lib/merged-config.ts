/**
 * Per-project overlay merge for shared JSON config (Phase 1, JSON-merge types).
 *
 * Merge-type config (variables first; glossary/conditions/styles later) isn't
 * override-by-whole-file like snippets/images — a project would then stop
 * inheriting shared additions. Instead a project keeps a SPARSE overlay at
 * `projects/<slug>/<file>` holding only its changed/added entries, and readers
 * merge it over the shared file here (overlay wins per key). Every consumer
 * (editor-meta, /api/variables, the compile pipeline) goes through this module
 * so shared and project both see one consistent merged view.
 */

import { getCachedFile, readProjectOverlay } from "./storage";
import type { Variables, VariableSet, VariableSetsData, Glossary, GlossaryTerm } from "./types";

/** Per-set, per-key origin so the manager can badge shared vs project. */
export type VariableScopes = Record<string, Record<string, "shared" | "project">>;

/** Parse a variables.json payload (sets or legacy flat) into sets form. */
function toSets(content: string): VariableSetsData {
  const data = JSON.parse(content);
  if (data?.sets && Array.isArray(data.sets)) return data as VariableSetsData;
  // Legacy flat format → a single "General" set (read-only normalization; the
  // /api/variables route owns persisting the migration of the shared file).
  return { sets: [{ name: "General", slug: "general", variables: (data ?? {}) as Variables }] };
}

/**
 * Merge a sparse project overlay over the shared sets. Overlay sets match
 * shared by `slug`; their variables overlay shared per key; overlay-only sets
 * (and keys) are appended as project-scoped. Returns the merged sets plus a
 * per-key scope map.
 */
export function mergeVariableSets(
  shared: VariableSetsData,
  overlay: VariableSetsData | null
): { merged: VariableSetsData; scopes: VariableScopes } {
  const scopes: VariableScopes = {};
  const overlayBySlug = new Map<string, VariableSet>(
    (overlay?.sets ?? []).map((s) => [s.slug, s])
  );
  const seen = new Set<string>();
  const merged: VariableSet[] = [];

  for (const set of shared.sets) {
    const ov = overlayBySlug.get(set.slug);
    seen.add(set.slug);
    const variables: Variables = { ...set.variables };
    const setScopes: Record<string, "shared" | "project"> = {};
    for (const k of Object.keys(set.variables)) setScopes[k] = "shared";
    if (ov) {
      for (const [k, v] of Object.entries(ov.variables)) {
        variables[k] = v;
        setScopes[k] = "project";
      }
    }
    scopes[set.slug] = setScopes;
    merged.push({ ...set, variables });
  }

  // Overlay-only sets (a project added an entirely new set).
  for (const ov of overlay?.sets ?? []) {
    if (seen.has(ov.slug)) continue;
    const setScopes: Record<string, "shared" | "project"> = {};
    for (const k of Object.keys(ov.variables)) setScopes[k] = "project";
    scopes[ov.slug] = setScopes;
    merged.push({ ...ov });
  }

  return { merged: { sets: merged }, scopes };
}

/** Load the shared variable sets (normalized to sets form; {} → empty). */
async function loadSharedSets(ref?: string): Promise<VariableSetsData> {
  try {
    const file = await getCachedFile("content/variables.json", ref);
    return toSets(file.content);
  } catch {
    return { sets: [] };
  }
}

/** Merged variable sets for the current project (shared + overlay) with scopes. */
export async function loadMergedVariableSets(
  ref?: string
): Promise<{ merged: VariableSetsData; scopes: VariableScopes }> {
  const shared = await loadSharedSets(ref);
  const overlayFile = await readProjectOverlay("variables.json");
  const overlay = overlayFile ? toSets(overlayFile.content) : null;
  return mergeVariableSets(shared, overlay);
}

/** Merged variables flattened to a single key→value map (compile / flat GET). */
export async function loadMergedVariablesFlat(ref?: string): Promise<Variables> {
  const { merged } = await loadMergedVariableSets(ref);
  const flat: Variables = {};
  for (const set of merged.sets) Object.assign(flat, set.variables);
  return flat;
}

// ── Glossary (terms keyed by name) ──────────────────────────────────────────

/** Per-term origin so the manager can badge shared vs project. */
export type GlossaryScopes = Record<string, "shared" | "project">;

/**
 * Merge a sparse project overlay over the shared glossary. Terms match by
 * `term` name; an overlay term overrides its shared twin's definition in place,
 * and overlay-only terms are appended as project-scoped.
 */
export function mergeGlossary(
  shared: Glossary,
  overlay: Glossary | null
): { merged: Glossary; scopes: GlossaryScopes } {
  const scopes: GlossaryScopes = {};
  const overlayByTerm = new Map<string, GlossaryTerm>(
    (overlay?.terms ?? []).map((t) => [t.term, t])
  );
  const seen = new Set<string>();
  const terms: GlossaryTerm[] = [];

  for (const t of shared.terms) {
    const ov = overlayByTerm.get(t.term);
    seen.add(t.term);
    scopes[t.term] = ov ? "project" : "shared";
    terms.push(ov ? { ...t, definition: ov.definition } : t);
  }
  for (const ov of overlay?.terms ?? []) {
    if (seen.has(ov.term)) continue;
    scopes[ov.term] = "project";
    terms.push(ov);
  }

  return { merged: { terms }, scopes };
}

function toGlossary(content: string): Glossary {
  const data = JSON.parse(content);
  return { terms: Array.isArray(data?.terms) ? (data.terms as GlossaryTerm[]) : [] };
}

/** Merged glossary for the current project (shared + overlay) with scopes. */
export async function loadMergedGlossary(
  ref?: string
): Promise<{ merged: Glossary; scopes: GlossaryScopes }> {
  let shared: Glossary = { terms: [] };
  try {
    shared = toGlossary((await getCachedFile("content/glossary.json", ref)).content);
  } catch { /* none yet */ }
  const overlayFile = await readProjectOverlay("glossary.json");
  const overlay = overlayFile ? toGlossary(overlayFile.content) : null;
  return mergeGlossary(shared, overlay);
}
