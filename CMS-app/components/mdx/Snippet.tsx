"use client";

interface SnippetProps {
  file: string;
  content?: string;
}

export default function Snippet({ file, content }: SnippetProps) {
  if (content) {
    return <div>{content}</div>;
  }

  return (
    <div
      style={{
        background: "#f8f9fa",
        border: "1px dashed #dee2e6",
        padding: "12px 16px",
        borderRadius: 4,
        color: "#6c757d",
        fontSize: 13,
      }}
    >
      Snippet: {file}
    </div>
  );
}
