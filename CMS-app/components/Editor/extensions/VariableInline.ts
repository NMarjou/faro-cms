import { Node, mergeAttributes } from "@tiptap/core";

export interface VariableInlineOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    variableInline: {
      insertVariable: (attrs: { name: string }) => ReturnType;
    };
  }
}

export const VariableInline = Node.create<VariableInlineOptions>({
  name: "variableInline",
  group: "inline",
  inline: true,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      name: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-variable") || "",
        renderHTML: (attributes) => ({
          "data-variable": attributes.name,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-node-type="variable"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-node-type": "variable",
        style:
          "background: var(--accent-light); color: var(--accent); padding: 1px 6px; border-radius: 3px; font-size: 13px; font-family: var(--font-mono);",
        contenteditable: "false",
      }),
      `{${node.attrs.name}}`,
    ];
  },

  addCommands() {
    return {
      insertVariable:
        (attrs) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs,
            })
            .run();
        },
    };
  },
});
