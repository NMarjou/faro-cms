"use client";

import type { ReactNode } from "react";

interface ConditionalProps {
  tags: string[];
  activeTags?: string[];
  children: ReactNode;
}

export default function Conditional({
  tags,
  activeTags = [],
  children,
}: ConditionalProps) {
  // If no active tags configured, show everything
  if (activeTags.length === 0) return <>{children}</>;

  // Show content only if at least one tag matches
  const hasMatch = tags.some((tag) => activeTags.includes(tag));
  if (!hasMatch) return null;

  return <>{children}</>;
}
