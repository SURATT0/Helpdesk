import type { Priority, TicketStatus } from "@/lib/domain";

/** Bar colours for the "Tickets by status" chart (presentational). */
export const STATUS_CHART: Record<
  TicketStatus,
  { label: string; color: string }
> = {
  new: { label: "New", color: "#3b82f6" },
  open: { label: "Open", color: "#0ea5e9" },
  in_progress: { label: "In Progress", color: "#f59e0b" },
  pending: { label: "Pending", color: "#8b5cf6" },
  resolved: { label: "Resolved", color: "#22c55e" },
  closed: { label: "Closed", color: "#cbd5e1" },
};

/** Donut colours for "Open by priority". */
export const PRIORITY_CHART: Record<Priority, { label: string; color: string }> =
  {
    critical: { label: "Critical", color: "#dc2626" },
    high: { label: "High", color: "#f59e0b" },
    medium: { label: "Medium", color: "#3b82f6" },
    low: { label: "Low", color: "#cbd5e1" },
  };

/** Build a conic-gradient string from ordered {value,color} slices. */
export function conicGradient(slices: { value: number; color: string }[]): string {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  const stops = slices.map((s) => {
    const start = (acc / total) * 100;
    acc += s.value;
    const end = (acc / total) * 100;
    return `${s.color} ${start}% ${end}%`;
  });
  return `conic-gradient(${stops.join(",")})`;
}
