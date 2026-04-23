import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const whitespaceKey = new PluginKey("whitespaceDecoration");

export const WhitespaceDecoration = Extension.create({
  name: "whitespaceDecoration",

  addProseMirrorPlugins() {
    let enabled = false;

    return [
      new Plugin({
        key: whitespaceKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, oldSet, _oldState, newState) {
            const meta = tr.getMeta(whitespaceKey);
            if (meta !== undefined) {
              enabled = meta;
            }
            if (!enabled) return DecorationSet.empty;

            const decorations: Decoration[] = [];
            newState.doc.descendants((node, pos) => {
              if (node.isText && node.text) {
                for (let i = 0; i < node.text.length; i++) {
                  if (node.text[i] === " ") {
                    const widget = Decoration.widget(pos + i, () => {
                      const dot = document.createElement("span");
                      dot.textContent = "·";
                      dot.className = "ws-dot";
                      dot.style.cssText =
                        "color: var(--ws-marker, #999); font-size: 14px; pointer-events: none; position: relative; margin-left: -0.1em; margin-right: -0.1em;";
                      dot.setAttribute("aria-hidden", "true");
                      return dot;
                    }, { side: 0 });
                    decorations.push(widget);
                  }
                }
              }
            });

            return DecorationSet.create(newState.doc, decorations);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

export { whitespaceKey };
