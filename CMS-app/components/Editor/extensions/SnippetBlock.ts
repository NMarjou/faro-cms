import { Node, mergeAttributes } from "@tiptap/core";

export interface SnippetBlockOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    snippetBlock: {
      insertSnippet: (attrs: { name: string }) => ReturnType;
    };
  }
}

export const SnippetBlock = Node.create<SnippetBlockOptions>({
  name: "snippetBlock",
  group: "block",
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
        parseHTML: (element) => element.getAttribute("data-snippet") || "",
        renderHTML: (attributes) => ({
          "data-snippet": attributes.name,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-node-type="snippet"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-node-type": "snippet",
        style:
          "background: var(--bg-secondary); border: 1px dashed var(--border); padding: 12px 16px; border-radius: 4px; margin: 8px 0; color: var(--fg-muted); font-size: 13px;",
        contenteditable: "false",
      }),
      `Snippet: ${node.attrs.name}`,
    ];
  },

  addCommands() {
    return {
      insertSnippet:
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
