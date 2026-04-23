import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export interface ConditionalMarkOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    conditionalMark: {
      setConditionalMark: (attrs: { tags: string[]; color?: string }) => ReturnType;
      unsetConditionalMark: () => ReturnType;
    };
  }
}

const conditionalMarkTooltipKey = new PluginKey("conditionalMarkTooltip");

export const ConditionalMark = Mark.create<ConditionalMarkOptions>({
  name: "conditionalMark",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      tags: {
        default: [],
        parseHTML: (element) => {
          const tags = element.getAttribute("data-tags");
          return tags ? JSON.parse(tags) : [];
        },
        renderHTML: (attributes) => ({
          "data-tags": JSON.stringify(attributes.tags),
        }),
      },
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-color"),
        renderHTML: (attributes) => {
          if (!attributes.color) return {};
          return { "data-color": attributes.color };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-mark-type="conditional"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const tags = HTMLAttributes["data-tags"]
      ? JSON.parse(HTMLAttributes["data-tags"])
      : [];
    const color = HTMLAttributes["data-color"] || "#f59e0b";
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-mark-type": "conditional",
        style: `background: ${hexToRgba(color, 0.15)}; border-bottom: 2px solid ${color}; padding: 0 1px; border-radius: 2px;`,
        title: `Condition: ${tags.join(", ")}`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setConditionalMark:
        (attrs) =>
        ({ commands }) => {
          return commands.setMark(this.name, attrs);
        },
      unsetConditionalMark:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
    };
  },

  addProseMirrorPlugins() {
    const markType = this.type;

    return [
      new Plugin({
        key: conditionalMarkTooltipKey,
        view(editorView) {
          // Create the tooltip DOM
          const tooltip = document.createElement("div");
          tooltip.className = "conditional-mark-tooltip";
          tooltip.style.cssText =
            "position: absolute; display: none; z-index: 200; background: var(--bg, #fff); border: 1px solid var(--border, #ddd); border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,.12); padding: 4px 8px; font-size: 12px; white-space: nowrap; pointer-events: auto; display: none; align-items: center; gap: 6px;";
          editorView.dom.parentElement?.appendChild(tooltip);

          function update() {
            const { state } = editorView;
            const { from, $from, empty } = state.selection;

            // Only show tooltip when cursor is collapsed (no selection) inside the mark
            if (!empty) {
              tooltip.style.display = "none";
              return;
            }

            // Check if cursor is inside a conditional mark
            const marks = $from.marks();
            const conditionalMark = marks.find((m) => m.type === markType);

            if (!conditionalMark) {
              tooltip.style.display = "none";
              return;
            }

            const tags = (conditionalMark.attrs.tags as string[]) || [];
            const color = (conditionalMark.attrs.color as string) || "#f59e0b";

            // Position tooltip
            const coords = editorView.coordsAtPos(from);
            const editorRect = editorView.dom.parentElement!.getBoundingClientRect();

            tooltip.style.display = "flex";
            tooltip.style.left = `${coords.left - editorRect.left}px`;
            tooltip.style.top = `${coords.bottom - editorRect.top + 4}px`;

            // Render tooltip content
            tooltip.innerHTML = "";

            // Tag label
            const label = document.createElement("span");
            label.style.cssText = `font-weight: 600; color: ${color};`;
            label.textContent = `\u26A1 ${tags.join(", ")}`;
            tooltip.appendChild(label);

            // Remove button
            const removeBtn = document.createElement("button");
            removeBtn.textContent = "Remove";
            removeBtn.title = "Remove condition (keep text)";
            removeBtn.style.cssText =
              "background: none; border: 1px solid var(--border, #ddd); border-radius: 4px; cursor: pointer; padding: 1px 6px; font-size: 11px; color: var(--danger, #e53e3e); line-height: 18px;";
            removeBtn.onmousedown = (e) => {
              e.preventDefault(); // Prevent focus loss
              e.stopPropagation();
              // Find the exact range of this mark around the cursor
              const { $from } = editorView.state.selection;
              let start = $from.pos;
              let end = $from.pos;

              // Walk back to find mark start
              const doc = editorView.state.doc;
              doc.nodesBetween($from.start(), $from.pos, (node, pos) => {
                if (node.isText && node.marks.some((m) => m.type === markType)) {
                  if (pos < start) start = pos;
                }
              });
              // Walk forward to find mark end
              doc.nodesBetween($from.pos, $from.end(), (node, pos) => {
                if (node.isText && node.marks.some((m) => m.type === markType)) {
                  const nodeEnd = pos + node.nodeSize;
                  if (nodeEnd > end) end = nodeEnd;
                }
              });

              // Remove the mark from this range
              const tr = editorView.state.tr.removeMark(start, end, markType);
              editorView.dispatch(tr);
              tooltip.style.display = "none";
            };
            tooltip.appendChild(removeBtn);
          }

          return {
            update,
            destroy() {
              tooltip.remove();
            },
          };
        },
      }),
    ];
  },
});

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(245, 158, 11, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
