"use client";

import { useTheme } from "./ThemeProvider";

interface FaroLogoProps {
  size?: number;
  variant?: "auto" | "dark-bg" | "light-bg";
}

/**
 * Faro lighthouse logo mark.
 * - dark-bg: gold lines on dark background (used in sidebar / dark mode)
 * - light-bg: navy lines with gold dot on light background
 * - auto: picks based on current theme
 */
export default function FaroLogo({ size = 28, variant = "auto" }: FaroLogoProps) {
  const { theme } = useTheme();

  // In light mode the sidebar is always navy, so the logo is always "dark-bg" style.
  // In dark mode everything is navy, so also "dark-bg".
  // "light-bg" is only used if explicitly requested (e.g. on a light content panel).
  const useDarkBg =
    variant === "dark-bg" ||
    (variant === "auto" && true); // sidebar is always navy in both modes

  const stroke = useDarkBg ? "#c8a96e" : "#0d1c2a";
  const dot = "#c8a96e";

  // The SVG viewBox is based on the logo coords: elements span from roughly -1 to 36 on x, -4 to 54 on y
  // Adding a bit of padding: viewBox="-4 -8 44 66"
  return (
    <svg
      width={size}
      height={size}
      viewBox="-4 -8 44 66"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* Pulse ring (subtle animation) */}
      <circle cx="28" cy="28" r="6" fill="none" stroke={dot} strokeWidth="0.5">
        <animate attributeName="r" values="6;18;6" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.45;0;0.45" dur="3s" repeatCount="indefinite" />
      </circle>
      {/* Tower */}
      <line x1="28" y1="28" x2="28" y2="54" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
      {/* Base */}
      <line x1="20" y1="54" x2="36" y2="54" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      {/* Light dot (source) */}
      <circle cx="28" cy="28" r="3.5" fill={dot} />
      {/* Beam 1 (narrow) */}
      <line x1="28" y1="28" x2="6" y2="-4" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
      {/* Beam 2 (mid) */}
      <line x1="28" y1="28" x2="1" y2="8" stroke={stroke} strokeWidth="1.2" strokeLinecap="round" opacity="0.65" />
      {/* Beam 3 (wide) */}
      <line x1="28" y1="28" x2="-1" y2="18" stroke={stroke} strokeWidth="1" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}
