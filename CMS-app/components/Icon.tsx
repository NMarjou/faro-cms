/**
 * Faro icon — thin wrapper over the Phosphor Icons web font.
 *
 * The Phosphor classes are loaded globally in app/layout.tsx (regular, bold,
 * duotone). Render as:
 *
 *   <Icon name="squares-four" />            // 16px regular
 *   <Icon name="caret-right" weight="bold" size={12} />
 *   <Icon name="lighthouse" weight="duotone" size={22} />
 *
 * `name` is the Phosphor icon slug without the `ph-` prefix
 * (see https://phosphoricons.com).
 */
import type { CSSProperties } from "react";

export type IconWeight = "regular" | "bold" | "fill" | "duotone";

interface IconProps {
  name: string;
  size?: number;
  weight?: IconWeight;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const WEIGHT_PREFIX: Record<IconWeight, string> = {
  regular: "ph",
  bold: "ph-bold",
  fill: "ph-fill",
  duotone: "ph-duotone",
};

export default function Icon({
  name,
  size = 16,
  weight = "regular",
  className,
  style,
  title,
}: IconProps) {
  const cls = `${WEIGHT_PREFIX[weight]} ph-${name}${className ? " " + className : ""}`;
  return (
    <i
      className={cls}
      style={{ fontSize: size, lineHeight: 1, flexShrink: 0, ...style }}
      aria-hidden={title ? undefined : true}
      title={title}
    />
  );
}
