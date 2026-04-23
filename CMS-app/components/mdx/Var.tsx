"use client";

interface VarProps {
  name: string;
  variables?: Record<string, string>;
}

export default function Var({ name, variables = {} }: VarProps) {
  const value = variables[name];
  if (value) return <>{value}</>;
  return (
    <span
      style={{
        background: "#eff6ff",
        color: "#2563eb",
        padding: "1px 6px",
        borderRadius: 3,
        fontSize: "0.9em",
        fontFamily: "monospace",
      }}
    >
      {`{${name}}`}
    </span>
  );
}
