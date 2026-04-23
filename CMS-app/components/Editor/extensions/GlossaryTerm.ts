import { Node, mergeAttributes } from "@tiptap/core";

export interface GlossaryTermOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    glossaryTerm: {
      insertGlossaryTerm: (attrs: { term: string; definition: string }) => ReturnType;
    };
  }
}

export const GlossaryTerm = Node.create<GlossaryTermOptions>({
  name: "glossaryTerm",
  group: "inline",
  inline: true,
  atom: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      term: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-term") || "",
        renderHTML: (attrs) => ({ "data-term": attrs.term }),
      },
      definition: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-definition") || "",
        renderHTML: (attrs) => ({ "data-definition": attrs.definition }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-node-type="glossary"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-node-type": "glossary",
        style: "border-bottom: 2px dotted var(--info); cursor: help; color: var(--info);",
        contenteditable: "false",
        title: node.attrs.definition,
      }),
      node.attrs.term,
    ];
  },

  addCommands() {
    return {
      insertGlossaryTerm:
        (attrs) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs })
            .run(),
    };
  },
});
