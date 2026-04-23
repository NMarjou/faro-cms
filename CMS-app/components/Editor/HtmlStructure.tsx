"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";

interface HtmlStructureProps {
  editor: Editor;
}

interface TreeNode {
  tag: string;
  attrs: string;
  children: TreeNode[];
  depth: number;
}

function buildTree(html: string): TreeNode[] {
  const nodes: TreeNode[] = [];
  const stack: TreeNode[] = [];
  const regex = /<\/?([a-z][a-z0-9]*)((?:\s+[^>]*?)?)\s*\/?>/gi;
  const selfClosing = new Set(["br", "hr", "img", "input"]);
  let match;

  while ((match = regex.exec(html)) !== null) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    const attrs = (match[2] || "").trim();
    const isClosing = full.startsWith("</");
    const isSelf = full.endsWith("/>") || selfClosing.has(tag);

    if (isClosing) {
      // Pop from stack
      if (stack.length > 0 && stack[stack.length - 1].tag === tag) {
        stack.pop();
      }
    } else {
      const node: TreeNode = {
        tag,
        attrs: summarizeAttrs(attrs),
        children: [],
        depth: stack.length,
      };

      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else {
        nodes.push(node);
      }

      if (!isSelf) {
        stack.push(node);
      }
    }
  }

  return nodes;
}

function summarizeAttrs(attrs: string): string {
  if (!attrs) return "";
  // Extract class and id for display
  const classMatch = attrs.match(/class="([^"]+)"/);
  const idMatch = attrs.match(/id="([^"]+)"/);
  const dataType = attrs.match(/data-node-type="([^"]+)"/);
  const parts: string[] = [];
  if (idMatch) parts.push(`#${idMatch[1]}`);
  if (classMatch) parts.push(`.${classMatch[1].split(" ").join(".")}`);
  if (dataType) parts.push(`[${dataType[1]}]`);
  return parts.join(" ");
}

function TreeNodeRow({ node }: { node: TreeNode }) {
  const [expanded, setExpanded] = useState(node.depth < 3);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className="structure-node"
        style={{ paddingLeft: node.depth * 14 + 4 }}
        onClick={() => hasChildren && setExpanded((p) => !p)}
      >
        {hasChildren ? (
          <span className="structure-arrow" style={{ transform: expanded ? "rotate(90deg)" : "none" }}>&#9654;</span>
        ) : (
          <span className="structure-arrow" style={{ visibility: "hidden" }}>&#9654;</span>
        )}
        <span className="structure-tag">&lt;{node.tag}&gt;</span>
        {node.attrs && <span className="structure-attrs">{node.attrs}</span>}
      </div>
      {expanded && node.children.map((child, i) => (
        <TreeNodeRow key={i} node={child} />
      ))}
    </div>
  );
}

export default function HtmlStructure({ editor }: HtmlStructureProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);

  useEffect(() => {
    const update = () => setTree(buildTree(editor.getHTML()));
    update();
    editor.on("update", update);
    return () => { editor.off("update", update); };
  }, [editor]);

  return (
    <div className="structure-panel">
      <div className="structure-header">HTML Structure</div>
      <div className="structure-tree">
        {tree.map((node, i) => (
          <TreeNodeRow key={i} node={node} />
        ))}
      </div>
    </div>
  );
}
