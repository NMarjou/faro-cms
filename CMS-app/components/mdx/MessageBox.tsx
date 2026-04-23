"use client";

import type { ReactNode } from "react";

interface MessageBoxProps {
  type: "info" | "tip" | "warning";
  children: ReactNode;
}

const styles: Record<string, { bg: string; border: string; label: string }> = {
  info: { bg: "#f0f9ff", border: "#0284c7", label: "Info" },
  tip: { bg: "#f0fdf4", border: "#16a34a", label: "Tip" },
  warning: { bg: "#fffbeb", border: "#d97706", label: "Warning" },
};

export default function MessageBox({ type, children }: MessageBoxProps) {
  const style = styles[type] || styles.info;
  return (
    <div
      style={{
        background: style.bg,
        borderLeft: `4px solid ${style.border}`,
        padding: "12px 16px",
        borderRadius: 4,
        margin: "12px 0",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
        {style.label}
      </div>
      <div>{children}</div>
    </div>
  );
}
