import { Node, mergeAttributes } from "@tiptap/core";

export interface VideoEmbedOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    videoEmbed: {
      insertVideo: (attrs: { src: string }) => ReturnType;
    };
  }
}

function toEmbedUrl(url: string): string {
  // YouTube: watch?v=X → embed/X
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  // Vimeo: vimeo.com/123 → player.vimeo.com/video/123
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  return url;
}

export const VideoEmbed = Node.create<VideoEmbedOptions>({
  name: "videoEmbed",
  group: "block",
  atom: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-src") || "",
        renderHTML: (attrs) => ({ "data-src": attrs.src }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-node-type="video"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const embedSrc = toEmbedUrl(node.attrs.src);
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-node-type": "video",
        style: "position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 8px; margin: 12px 0; background: #000;",
        contenteditable: "false",
      }),
      [
        "iframe",
        {
          src: embedSrc,
          style: "position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;",
          allowfullscreen: "true",
          loading: "lazy",
        },
      ],
    ];
  },

  addCommands() {
    return {
      insertVideo:
        (attrs) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs })
            .run(),
    };
  },
});
