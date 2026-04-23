import { Extension } from "@tiptap/core";

export const ListNesting = Extension.create({
  name: "listNesting",

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive("listItem")) {
          return this.editor.chain().focus().sinkListItem("listItem").run();
        }
        return false;
      },
      "Shift-Tab": () => {
        if (this.editor.isActive("listItem")) {
          return this.editor.chain().focus().liftListItem("listItem").run();
        }
        return false;
      },
    };
  },
});
