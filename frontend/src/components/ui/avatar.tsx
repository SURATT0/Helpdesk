import { AVATAR_TONE, type AvatarTone } from "@/lib/palette";
import { initials } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function Avatar({
  name,
  size = 22,
  tone = "blue",
  className,
}: {
  name: string;
  size?: number;
  tone?: AvatarTone;
  className?: string;
}) {
  const p = AVATAR_TONE[tone] ?? AVATAR_TONE.blue;
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
