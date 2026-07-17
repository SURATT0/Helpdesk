import { initials } from "@/lib/utils";
import { cn } from "@/lib/utils";

const PALETTES: Record<string, { bg: string; fg: string }> = {
  blue: { bg: "#dbeafe", fg: "#1d4ed8" },
  green: { bg: "#d1fae5", fg: "#047857" },
  pink: { bg: "#fce7f3", fg: "#be185d" },
  red: { bg: "#fee2e2", fg: "#b91c1c" },
};

export function Avatar({
  name,
  size = 22,
  tone = "blue",
  className,
}: {
  name: string;
  size?: number;
  tone?: keyof typeof PALETTES;
  className?: string;
}) {
  const p = PALETTES[tone] ?? PALETTES.blue;
  return (
    <span
      className={cn(
        "inline-grid place-items-center rounded-full font-semibold",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: p.bg,
        color: p.fg,
        fontSize: Math.max(9, Math.round(size * 0.42)),
      }}
    >
      {initials(name)}
    </span>
  );
}
