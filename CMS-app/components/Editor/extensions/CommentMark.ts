import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export interface CommentMarkOptions {
  HTMLAttributes: Record<string, string>;
  onCommentClick?: (commentId: string) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentMark: {
      setCommentMark: (attrs: { commentId: string }) => ReturnType;
      unsetCommentMark: (commentId: string) => ReturnType;
    };
  }
}

const commentClickKey = new PluginKey("commentClick");

export const CommentMark = Mark.create<CommentMarkOptions>({
  name: "commentMark",

  addOptions() {
    return {
      HTMLAttributes: {},
      onCommentClick: undefined,
    };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-id"),
        renderHTML: (attributes) => ({
          "data-comment-id": attributes.commentId,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-comment-id]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "comment-highlight",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCommentMark:
        (attrs) =>
        ({ commands }) => {
          return commands.setMark(this.name, attrs);
        },
      unsetCommentMark:
        (commentId) =>
        ({ tr, state, dispatch }) => {
          const markType = state.schema.marks.commentMark;
          if (!markType) return false;
          // Remove all instances of this comment mark from the document
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            const mark = node.marks.find(
              (m) => m.type === markType && m.attrs.commentId === commentId
            );
            if (mark) {
              tr.removeMark(pos, pos + node.nodeSize, mark);
            }
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const ext = this;

    return [
      new Plugin({
        key: commentClickKey,
        props: {
          handleClick(view, pos) {
            const $pos = view.state.doc.resolve(pos);
            const marks = $pos.marks();
            const commentMark = marks.find((m) => m.type.name === "commentMark");
            if (commentMark && ext.options.onCommentClick) {
              ext.options.onCommentClick(commentMark.attrs.commentId as string);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
