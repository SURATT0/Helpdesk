/**
 * Minimal className combiner. Kept dependency-free (no clsx/tailwind-merge)
 * to keep the scaffold light; swap for `cn` from shadcn/ui if that stack lands.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
