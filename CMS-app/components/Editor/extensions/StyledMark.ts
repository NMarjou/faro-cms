import { Mark, mergeAttributes } from "@tiptap/core";

export interface StyledMarkOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    styledMark: {
      setStyledMark: (attrs: { className: string }) => ReturnType;
      unsetStyledMark: () => ReturnType;
    };
  }
}

export const StyledMark = Mark.create<StyledMarkOptions>({
  name: "styledMark",

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      className: {
        default: "",
        parseHTML: (el) => el.getAttribute("class") || "",
        renderHTML: (attrs) => (attrs.className ? { class: attrs.className } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[class]",
        getAttrs: (el) => {
          const cls = (el as HTMLElement).getAttribute("class") || "";
          // Only match known styled classes — skip ProseMirror internal classes
          const known = ["interface", "code", "infodate", "text-green", "text-red"];
          if (known.some((k) => cls.includes(k))) {
            return { className: cls };
          }
          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setStyledMark:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetStyledMark:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
