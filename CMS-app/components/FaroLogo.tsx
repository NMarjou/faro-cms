"use client";

interface FaroLogoProps {
  size?: number;
  showWordmark?: boolean;
  glow?: boolean;
}

/**
 * Faro lighthouse mark — "Lighthouse at Sea" identity.
 * - 5 gold rays + dot at the lantern (stroke `var(--accent-glow)`).
 * - Tapered indigo tower with a soft quadratic dome and 2 thick stripes
 *   (stroke `var(--sidebar-fg)`, so it inverts cleanly between modes).
 * - Optional radial gold glow behind the mark.
 * - Optional "Faro" wordmark in Lora 500, baseline-aligned to the bottom of
 *   the icon. Source: design system `Primitives.jsx → FaroMark`.
 */
export default function FaroLogo({
  size = 28,
  showWordmark = true,
  glow = true,
}: FaroLogoProps) {
  const svgSize = Math.round(size * 1.15);
  const svgHeight = Math.round((svgSize * 25) / 32);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap: showWordmark ? 8 : 0,
        position: "relative",
        flexShrink: 0,
      }}
    >
      {glow && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: -2,
            top: "50%",
            width: svgSize + 4,
            height: svgSize + 4,
            transform: "translateY(-50%)",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(232,180,80,.35) 0%, transparent 60%)",
            pointerEvents: "none",
          }}
        />
      )}
      <svg
        viewBox="0 2 32 25"
        width={svgSize}
        height={svgHeight}
        aria-hidden="true"
        fill="none"
        style={{ position: "relative", flexShrink: 0, display: "block" }}
      >
        {/* Five gold rays + dot at the lantern */}
        <g stroke="var(--accent-glow)" strokeWidth="1" strokeLinecap="round">
          <line x1="16" y1="8.5" x2="16" y2="3" />
          <line x1="16" y1="8.5" x2="20.5" y2="4.5" />
          <line x1="16" y1="8.5" x2="11.5" y2="4.5" />
          <line x1="16" y1="8.5" x2="24" y2="8.5" />
          <line x1="16" y1="8.5" x2="8" y2="8.5" />
        </g>
        <circle cx="16" cy="8.5" r="1.3" fill="var(--accent-glow)" />
        {/* Tapered tower with rounded dome and 2 thick stripes */}
        <g
          stroke="var(--sidebar-fg)"
          strokeWidth="1.25"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path d="M12.5 11.5 Q16 9.2 19.5 11.5" />
          <path d="M13.4 11.5 L11.8 26.5" />
          <path d="M18.6 11.5 L20.2 26.5" />
          <line x1="10.8" y1="26.5" x2="21.2" y2="26.5" />
          <line x1="12.7" y1="15.5" x2="19.3" y2="15.5" strokeWidth="2.4" />
          <line x1="12.3" y1="20.5" x2="19.7" y2="20.5" strokeWidth="2.4" />
        </g>
      </svg>
      {showWordmark && (
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            fontSize: Math.round(size * 0.82),
            letterSpacing: ".005em",
            color: "var(--sidebar-fg)",
            lineHeight: 0.85,
          }}
        >
          Faro
        </span>
      )}
    </span>
  );
}
