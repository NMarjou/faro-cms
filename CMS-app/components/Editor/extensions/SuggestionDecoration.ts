import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Visual-only inline decoration for pending suggestion spans.
 *
 * The tech writer's editor pings this extension whenever the
 * pending-suggestion list changes; we walk the document, locate the
 * (occurrenceIndex)th match of each suggestion's `originalText`, and apply
 * an inline class for styling.
 *
 * Decorations don't modify the document, so they don't persist to disk and
 * disappear cleanly once a suggestion is accepted or rejected (the next
 * setMeta with the updated list rebuilds without that entry).
 *
 * Limitation: matches must live inside a single text node. If `originalText`
 * spans formatting boundaries (e.g. a bold word in the middle), it won't
 * highlight. Acceptable trade-off for v1 — the accept logic has the same
 * constraint.
 */

export interface SuggestionHighlight {
  id: string;
  originalText: string;
  occurrenceIndex: number;
}

interface PluginValue {
  highlights: SuggestionHighlight[];
  deco: DecorationSet;
}

export const suggestionDecorationKey = new PluginKey<PluginValue>("suggestionDecoration");

function locateOccurrence(
  doc: PMNode,
  needle: string,
  index: number
): { from: number; to: number } | null {
  let count = 0;
  let result: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.isText && node.text) {
      let cursor = 0;
      while (true) {
        const idx = node.text.indexOf(needle, cursor);
        if (idx === -1) break;
        if (count === index) {
          result = { from: pos + idx, to: pos + idx + needle.length };
          return false;
        }
        count += 1;
        cursor = idx + needle.length;
      }
    }
    return true;
  });
  return result;
}

function buildDecorations(doc: PMNode, highlights: SuggestionHighlight[]): DecorationSet {
  const list: Decoration[] = [];
  for (const h of highlights) {
    if (!h.originalText.trim()) continue;
    const pos = locateOccurrence(doc, h.originalText, h.occurrenceIndex);
    if (!pos) continue;
    list.push(
      Decoration.inline(pos.from, pos.to, {
        class: "suggestion-highlight",
        "data-suggestion-id": h.id,
        title: "Pending suggestion — click to open in the review drawer",
      })
    );
  }
  return DecorationSet.create(doc, list);
}

export const SuggestionDecoration = Extension.create({
  name: "suggestionDecoration",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: suggestionDecorationKey,
        state: {
          init(): PluginValue {
            return { highlights: [], deco: DecorationSet.empty };
          },
          apply(tr, value, _oldState, newState): PluginValue {
            const meta = tr.getMeta(suggestionDecorationKey) as SuggestionHighlight[] | undefined;
            // No metadata: keep current highlights but map decorations to the
            // new document so positions stay valid through edits.
            if (meta === undefined) {
              return {
                highlights: value.highlights,
                deco: tr.docChanged
                  ? buildDecorations(newState.doc, value.highlights)
                  : value.deco,
              };
            }
            return {
              highlights: meta,
              deco: buildDecorations(newState.doc, meta),
            };
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.deco;
          },
        },
      }),
    ];
  },
});
