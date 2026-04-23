import { Node, mergeAttributes } from "@tiptap/core";

export interface MessageBoxOptions {
  types: string[];
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    messageBox: {
      setMessageBox: (attrs: { type: string }) => ReturnType;
      toggleMessageBox: (attrs: { type: string }) => ReturnType;
    };
  }
}

/** Maps CMS callout type → Flare CSS class */
const TYPE_TO_CLASS: Record<string, string> = {
  danger: "message-red",
  info: "message-blue",
  tip: "message-green",
  warning: "message-orange",
  note: "message-purple",
};

/** Maps Flare CSS class → CMS callout type */
const CLASS_TO_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_TO_CLASS).map(([type, cls]) => [cls, type])
);

/** Human-readable labels */
const TYPE_LABEL: Record<string, string> = {
  info: "Info",
  tip: "Tip",
  warning: "Warning",
  danger: "Danger",
  note: "Note",
};

export const MessageBox = Node.create<MessageBoxOptions>({
  name: "messageBox",
  group: "block",
  content: "block+",
  defining: true,

  addOptions() {
    return {
      types: ["info", "tip", "warning", "danger", "note"],
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      type: {
        default: "info",
        parseHTML: (element) => element.getAttribute("data-type") || "info",
        renderHTML: (attributes) => ({
          "data-type": attributes.type,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-node-type="messageBox"]',
      },
      // Parse Flare-style message divs
      ...Object.entries(CLASS_TO_TYPE).map(([cls, type]) => ({
        tag: `div.${cls}`,
        getAttrs: () => ({ type }),
      })),
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const type = node.attrs.type as string;
    const className = TYPE_TO_CLASS[type] || TYPE_TO_CLASS.info;
    const label = TYPE_LABEL[type] || TYPE_LABEL.info;

    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-node-type": "messageBox",
        class: className,
      }),
      [
        "div",
        { style: "font-weight: 600; font-size: 13px; margin-bottom: 4px;" },
        label,
      ],
      ["div", 0],
    ];
  },

  addCommands() {
    return {
      setMessageBox:
        (attrs) =>
        ({ commands }) => {
          return commands.wrapIn(this.name, attrs);
        },
      toggleMessageBox:
        (attrs) =>
        ({ commands }) => {
          return commands.toggleWrap(this.name, attrs);
        },
    };
  },
});
