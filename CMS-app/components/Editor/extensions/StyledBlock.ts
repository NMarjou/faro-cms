import { Node, mergeAttributes } from "@tiptap/core";

export interface StyledBlockOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    styledBlock: {
      setStyledBlock: (attrs: { className: string }) => ReturnType;
    };
  }
}

export const StyledBlock = Node.create<StyledBlockOptions>({
  name: "styledBlock",
  group: "block",
  content: "block+",
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      className: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-style") || el.getAttribute("class") || "",
        renderHTML: (attrs) => ({ "data-style": attrs.className }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-node-type="styled"]' },
      // Parse known block-level CSS classes from editor-styles.css
      { tag: "p.figure-caption", getAttrs: () => ({ className: "figure-caption" }) },
      { tag: "p.red", getAttrs: () => ({ className: "red" }) },
      { tag: "p.green", getAttrs: () => ({ className: "green" }) },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-node-type": "styled",
        class: node.attrs.className,
      }),
      [
        "div",
        {
          style: "position: absolute; top: -10px; right: 12px; background: var(--bg-secondary); color: var(--fg-muted); padding: 0 6px; font-size: 10px; border-radius: 3px;",
          contenteditable: "false",
        },
        `.${node.attrs.className}`,
      ],
      ["div", 0],
    ];
  },

  addCommands() {
    return {
      setStyledBlock:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
    };
  },
});
