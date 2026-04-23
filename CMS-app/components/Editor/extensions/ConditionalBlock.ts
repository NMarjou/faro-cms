import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export interface ConditionalBlockOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    conditionalBlock: {
      setConditional: (attrs: { tags: string[]; color?: string }) => ReturnType;
      removeConditionalBlock: () => ReturnType;
    };
  }
}

export const ConditionalBlock = Node.create<ConditionalBlockOptions>({
  name: "conditionalBlock",
  group: "block",
  content: "block+",
  defining: true,

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
        tag: 'div[data-node-type="conditional"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const tags = (node.attrs.tags as string[]) || [];
    const color = (node.attrs.color as string) || "#f59e0b";
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-node-type": "conditional",
        style: `border: 2px dashed ${color}; border-left: 4px solid ${color}; background: ${hexToRgba(color, 0.05)}; padding: 16px 16px 12px 16px; border-radius: 4px; margin: 8px 0; position: relative;`,
      }),
      [
        "div",
        {
          style: `position: absolute; top: -10px; left: 12px; background: ${color}; color: #fff; padding: 1px 8px; font-size: 10px; font-weight: 600; border-radius: 3px; letter-spacing: 0.3px; display: flex; align-items: center; gap: 4px;`,
          contenteditable: "false",
        },
        `\u26A1 ${tags.join(", ")}`,
        [
          "span",
          {
            "data-action": "remove-conditional-block",
            style: "cursor: pointer; margin-left: 4px; font-size: 13px; line-height: 1; opacity: 0.8; font-weight: 400;",
            title: "Remove condition (keep content)",
          },
          "\u00D7",
        ],
      ],
      ["div", { style: "margin-top: 4px;" }, 0],
    ];
  },

  addCommands() {
    return {
      setConditional:
        (attrs) =>
        ({ editor, commands }) => {
          // Try wrapIn directly — works when cursor is in a block or full blocks selected
          if (editor.can().wrapIn(this.name, attrs)) {
            return commands.wrapIn(this.name, attrs);
          }

          // Fallback: select the current block(s) first, then wrap
          const { $from, $to } = editor.state.selection;
          // Expand selection to cover full block(s)
          const start = $from.start($from.depth);
          const end = $to.end($to.depth);
          editor.commands.setTextSelection({ from: start, to: end });

          return commands.wrapIn(this.name, attrs);
        },
      removeConditionalBlock:
        () =>
        ({ commands }) => {
          return commands.lift(this.name);
        },
    };
  },

  addProseMirrorPlugins() {
    const nodeName = this.name;
    return [
      new Plugin({
        key: new PluginKey("conditionalBlockRemove"),
        props: {
          handleClick(view, _pos, event) {
            const target = event.target as HTMLElement;
            if (target.getAttribute("data-action") === "remove-conditional-block") {
              // Find the conditional block node that this button belongs to
              const dom = target.closest('[data-node-type="conditional"]');
              if (!dom) return false;

              const pos = view.posAtDOM(dom, 0);
              const resolved = view.state.doc.resolve(pos);

              // Walk up to find the conditionalBlock node
              for (let depth = resolved.depth; depth >= 0; depth--) {
                const node = resolved.node(depth);
                if (node.type.name === nodeName) {
                  const start = resolved.before(depth);
                  // Lift: replace the wrapper with its children
                  const { tr } = view.state;
                  const nodeAt = view.state.doc.nodeAt(start);
                  if (nodeAt) {
                    // Replace the conditional block with its content
                    tr.replaceWith(start, start + nodeAt.nodeSize, nodeAt.content);
                    view.dispatch(tr);
                  }
                  return true;
                }
              }
              return false;
            }
            return false;
          },
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
