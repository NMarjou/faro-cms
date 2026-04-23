import type { JSONContent } from "@tiptap/react";
import matter from "gray-matter";
import type { ArticleFrontmatter } from "@/lib/types";

interface ParsedMdx {
  frontmatter: ArticleFrontmatter;
  doc: JSONContent;
}

/**
 * Parse an MDX string into TipTap JSON content + frontmatter.
 */
export function deserializeFromMdx(mdxString: string): ParsedMdx {
  const { data, content } = matter(mdxString);
  const doc = parseMarkdown(content.trim());
  return {
    frontmatter: data as ArticleFrontmatter,
    doc,
  };
}

function parseMarkdown(md: string): JSONContent {
  const lines = md.split("\n");
  const nodes: JSONContent[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      nodes.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: parseInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      nodes.push({ type: "horizontalRule" });
      i++;
      continue;
    }

    // Code block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      nodes.push({
        type: "codeBlock",
        attrs: { language: lang },
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    // Self-closing snippet: <Snippet file="..." />
    if (/^<Snippet\s+file="[^"]+"\s*\/>$/.test(line.trim())) {
      const m = line.trim().match(/^<Snippet\s+file="([^"]+)"\s*\/>$/);
      if (m) {
        nodes.push({ type: "snippetBlock", attrs: { name: m[1] } });
        i++;
        continue;
      }
    }

    // Self-closing Video: <Video src="..." />
    const videoMatch = line.trim().match(/^<Video\s+src="([^"]+)"\s*\/>$/);
    if (videoMatch) {
      nodes.push({ type: "videoEmbed", attrs: { src: videoMatch[1] } });
      i++;
      continue;
    }

    // Self-closing Glossary: <Glossary term="..." definition="..." />
    const glossaryMatch = line.trim().match(/^<Glossary\s+term="([^"]+)"\s+definition="([^"]+)"\s*\/>$/);
    if (glossaryMatch) {
      nodes.push({ type: "glossaryTerm", attrs: { term: glossaryMatch[1], definition: glossaryMatch[2] } });
      i++;
      continue;
    }

    // StyledBlock: <StyledBlock className="...">
    const styledOpen = line.trim().match(/^<StyledBlock\s+className="([^"]+)"\s*>$/);
    if (styledOpen) {
      const innerLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("</StyledBlock>")) {
        innerLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const innerDoc = parseMarkdown(innerLines.join("\n").trim());
      nodes.push({
        type: "styledBlock",
        attrs: { className: styledOpen[1] },
        content: innerDoc.content || [{ type: "paragraph" }],
      });
      continue;
    }

    // MessageBox block
    const messageBoxOpen = line.trim().match(/^<MessageBox\s+type="([^"]+)"\s*>$/);
    if (messageBoxOpen) {
      const innerLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("</MessageBox>")) {
        innerLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing tag
      const innerDoc = parseMarkdown(innerLines.join("\n").trim());
      nodes.push({
        type: "messageBox",
        attrs: { type: messageBoxOpen[1] },
        content: innerDoc.content || [{ type: "paragraph" }],
      });
      continue;
    }

    // Conditional block
    const conditionalOpen = line.trim().match(/^<Conditional\s+tags=\{(\[.*?\])\}\s*>$/);
    if (conditionalOpen) {
      let tags: string[] = [];
      try { tags = JSON.parse(conditionalOpen[1]); } catch { /* */ }
      const innerLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("</Conditional>")) {
        innerLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const innerDoc = parseMarkdown(innerLines.join("\n").trim());
      nodes.push({
        type: "conditionalBlock",
        attrs: { tags },
        content: innerDoc.content || [{ type: "paragraph" }],
      });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ") || line === ">") {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith("> ") || lines[i] === ">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const innerDoc = parseMarkdown(quoteLines.join("\n").trim());
      nodes.push({
        type: "blockquote",
        content: innerDoc.content || [{ type: "paragraph" }],
      });
      continue;
    }

    // Bullet list
    if (/^\s*[-*+]\s/.test(line)) {
      const items: JSONContent[] = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*+]\s/, "");
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(text) }],
        });
        i++;
      }
      nodes.push({ type: "bulletList", content: items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const items: JSONContent[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+\.\s/, "");
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(text) }],
        });
        i++;
      }
      nodes.push({ type: "orderedList", content: items });
      continue;
    }

    // Table
    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].includes("|") &&
        lines[i].trim().startsWith("|")
      ) {
        tableLines.push(lines[i]);
        i++;
      }
      nodes.push(parseTable(tableLines));
      continue;
    }

    // Paragraph (default) — consume lines until we hit a blank line or block element
    {
      const paraLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== "") {
        const l = lines[i];
        // Stop at block-level elements
        if (
          /^#{1,6}\s/.test(l) ||
          l.trim().startsWith("```") ||
          /^---+$/.test(l.trim()) ||
          /^<MessageBox\s/.test(l.trim()) ||
          /^<Conditional\s/.test(l.trim()) ||
          /^<\/MessageBox>/.test(l.trim()) ||
          /^<\/Conditional>/.test(l.trim()) ||
          /^<Snippet\s/.test(l.trim()) ||
          (l.startsWith("> ") && paraLines.length === 0) ||
          (/^\s*[-*+]\s/.test(l) && paraLines.length === 0) ||
          (/^\s*\d+\.\s/.test(l) && paraLines.length === 0) ||
          (l.includes("|") && l.trim().startsWith("|") && paraLines.length === 0)
        ) {
          break;
        }
        paraLines.push(l);
        i++;
      }

      if (paraLines.length > 0) {
        nodes.push({
          type: "paragraph",
          content: parseInline(paraLines.join(" ")),
        });
      } else {
        // Safety: if nothing was consumed, skip this line to prevent infinite loop
        i++;
      }
    }
  }

  return {
    type: "doc",
    content: nodes.length > 0 ? nodes : [{ type: "paragraph" }],
  };
}

function parseInline(text: string): JSONContent[] {
  if (!text) return [{ type: "text", text: " " }];

  const nodes: JSONContent[] = [];
  const regex =
    /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\)|<Var\s+name="([^"]+)"\s*\/>|<Glossary\s+term="([^"]+)"\s+definition="([^"]+)"\s*\/>|<u>(.+?)<\/u>|~~(.+?)~~|<Cond\s+tags=\{(\[.*?\])\}>(.+?)<\/Cond>)/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      nodes.push({ type: "text", text: match[2], marks: [{ type: "bold" }] });
    } else if (match[3]) {
      nodes.push({ type: "text", text: match[3], marks: [{ type: "italic" }] });
    } else if (match[4]) {
      nodes.push({ type: "text", text: match[4], marks: [{ type: "code" }] });
    } else if (match[5] && match[6]) {
      nodes.push({ type: "text", text: match[5], marks: [{ type: "link", attrs: { href: match[6] } }] });
    } else if (match[7]) {
      nodes.push({ type: "variableInline", attrs: { name: match[7] } });
    } else if (match[8] && match[9]) {
      // Glossary term
      nodes.push({ type: "glossaryTerm", attrs: { term: match[8], definition: match[9] } });
    } else if (match[10]) {
      nodes.push({ type: "text", text: match[10], marks: [{ type: "underline" }] });
    } else if (match[11]) {
      nodes.push({ type: "text", text: match[11], marks: [{ type: "strike" }] });
    } else if (match[12] && match[13]) {
      // Inline conditional: <Cond tags={[...]}>text</Cond>
      let condTags: string[] = [];
      try { condTags = JSON.parse(match[12]); } catch { /* */ }
      nodes.push({ type: "text", text: match[13], marks: [{ type: "conditionalMark", attrs: { tags: condTags } }] });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: "text", text: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: "text", text: text || " " }];
}

function parseTable(lines: string[]): JSONContent {
  const dataLines = lines.filter((l) => !l.trim().match(/^\|[\s-:|]+\|$/));

  const rows = dataLines.map((line, rowIndex) => {
    const cells = line
      .split("|")
      .filter((c) => c.trim() !== "")
      .map((cellText) => ({
        type: rowIndex === 0 ? "tableHeader" : ("tableCell" as string),
        content: [{ type: "paragraph", content: parseInline(cellText.trim()) }],
      }));

    return { type: "tableRow", content: cells };
  });

  return { type: "table", content: rows };
}
