import type { JSONContent } from "@tiptap/react";
import type { ArticleFrontmatter } from "@/lib/types";
import matter from "gray-matter";

/**
 * Serialize TipTap JSON content + frontmatter into an MDX string.
 */
export function serializeToMdx(
  doc: JSONContent,
  frontmatter: ArticleFrontmatter
): string {
  const body = serializeNode(doc);
  const fm = matter.stringify("", frontmatter).trim();
  return `${fm}\n\n${body.trim()}\n`;
}

function serializeNode(node: JSONContent, depth = 0): string {
  if (!node) return "";

  switch (node.type) {
    case "doc":
      return (node.content || []).map((n) => serializeNode(n, depth)).join("\n\n");

    case "paragraph":
      return serializeInline(node.content);

    case "heading": {
      const level = node.attrs?.level || 1;
      const prefix = "#".repeat(level);
      return `${prefix} ${serializeInline(node.content)}`;
    }

    case "bulletList":
      return (node.content || [])
        .map((item) => serializeListItem(item, "- ", depth))
        .join("\n");

    case "orderedList":
      return (node.content || [])
        .map((item, i) => serializeListItem(item, `${i + 1}. `, depth))
        .join("\n");

    case "listItem":
      return (node.content || [])
        .map((n) => serializeNode(n, depth))
        .join("\n");

    case "blockquote":
      return (node.content || [])
        .map((n) => `> ${serializeNode(n, depth)}`)
        .join("\n> \n");

    case "codeBlock": {
      const lang = node.attrs?.language || "";
      const code = (node.content || []).map((n) => n.text || "").join("");
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    case "horizontalRule":
      return "---";

    case "table":
      return serializeTable(node);

    case "image": {
      const src = node.attrs?.src || "";
      const alt = node.attrs?.alt || "";
      return `![${alt}](${src})`;
    }

    // Custom nodes
    case "messageBox": {
      const type = node.attrs?.type || "info";
      const inner = (node.content || [])
        .map((n) => serializeNode(n, depth))
        .join("\n\n");
      return `<MessageBox type="${type}">\n\n${inner}\n\n</MessageBox>`;
    }

    case "variableInline": {
      const name = node.attrs?.name || "";
      return `<Var name="${name}" />`;
    }

    case "conditionalBlock": {
      const tags = JSON.stringify(node.attrs?.tags || []);
      const inner = (node.content || [])
        .map((n) => serializeNode(n, depth))
        .join("\n\n");
      return `<Conditional tags={${tags}}>\n\n${inner}\n\n</Conditional>`;
    }

    case "snippetBlock": {
      const name = node.attrs?.name || "";
      return `<Snippet file="${name}" />`;
    }

    case "videoEmbed": {
      const src = node.attrs?.src || "";
      return `<Video src="${src}" />`;
    }

    case "glossaryTerm": {
      const term = node.attrs?.term || "";
      const definition = (node.attrs?.definition || "").replace(/"/g, '\\"');
      return `<Glossary term="${term}" definition="${definition}" />`;
    }

    case "styledBlock": {
      const className = node.attrs?.className || "";
      const inner = (node.content || [])
        .map((n) => serializeNode(n, depth))
        .join("\n\n");
      return `<StyledBlock className="${className}">\n\n${inner}\n\n</StyledBlock>`;
    }

    default:
      // Fallback: try to serialize content
      if (node.content) {
        return (node.content || [])
          .map((n) => serializeNode(n, depth))
          .join("\n\n");
      }
      return node.text || "";
  }
}

function serializeListItem(
  node: JSONContent,
  prefix: string,
  depth: number
): string {
  const indent = "  ".repeat(depth);
  const content = (node.content || [])
    .map((n, i) => {
      const text = serializeNode(n, depth + 1);
      return i === 0 ? `${indent}${prefix}${text}` : `${indent}  ${text}`;
    })
    .join("\n");
  return content;
}

function serializeInline(content?: JSONContent[]): string {
  if (!content) return "";
  return content
    .map((node) => {
      if (node.type === "variableInline") {
        return `<Var name="${node.attrs?.name || ""}" />`;
      }
      if (node.type === "glossaryTerm") {
        const def = (node.attrs?.definition || "").replace(/"/g, '\\"');
        return `<Glossary term="${node.attrs?.term || ""}" definition="${def}" />`;
      }

      let text = node.text || "";
      const marks = node.marks || [];

      for (const mark of marks) {
        switch (mark.type) {
          case "bold":
            text = `**${text}**`;
            break;
          case "italic":
            text = `*${text}*`;
            break;
          case "underline":
            text = `<u>${text}</u>`;
            break;
          case "strike":
            text = `~~${text}~~`;
            break;
          case "code":
            text = `\`${text}\``;
            break;
          case "link":
            text = `[${text}](${mark.attrs?.href || ""})`;
            break;
          case "conditionalMark": {
            const tags = JSON.stringify(mark.attrs?.tags || []);
            text = `<Cond tags={${tags}}>${text}</Cond>`;
            break;
          }
        }
      }

      return text;
    })
    .join("");
}

function serializeTable(node: JSONContent): string {
  const rows = node.content || [];
  if (rows.length === 0) return "";

  const serializedRows = rows.map((row) =>
    (row.content || []).map((cell) =>
      serializeInline(cell.content?.[0]?.content)
    )
  );

  const lines: string[] = [];
  for (let i = 0; i < serializedRows.length; i++) {
    lines.push(`| ${serializedRows[i].join(" | ")} |`);
    if (i === 0) {
      lines.push(
        `| ${serializedRows[i].map(() => "---").join(" | ")} |`
      );
    }
  }

  return lines.join("\n");
}
