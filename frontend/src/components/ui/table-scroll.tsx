import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The horizontal scroller that every column-grid table in this app needs.
 *
 * Those tables are CSS grids with mostly-fixed px column templates, so on a
 * narrow viewport one of two things happens, and neither is acceptable:
 *
 * - The grid keeps its width and an ancestor's `overflow-hidden` clips it — the
 *   last columns are then hidden with nothing able to scroll to them. The
 *   Dashboard's My Tickets table did exactly this: at 375px it hid 280px of
 *   itself, and SLA Due sat at x=630 even with the page scrolled as far right
 *   as it would go.
 * - Or the grid shrinks to fit and its `1fr` column collapses towards zero, so
 *   the column carrying the actual subject line (or the compliance bar) becomes
 *   unreadable. My Tickets showed this too: the subject column measured 43px.
 *
 * The fix needs both halves — a scroll container AND a width floor — so they
 * live in one component rather than in two classes a caller has to remember to
 * pair. Put non-scrolling chrome (a card title, a bulk-action bar) OUTSIDE this,
 * as a sibling, so it stays put while the columns move.
 *
 * `minWidth` is an inline style rather than a `min-w-[…]` class on purpose:
 * Tailwind emits utilities by scanning source text, so a composed class name
 * built from a prop would never be generated at all.
 */
export function TableScroll({
  minWidth,
  className,
  children,
}: {
  /** Width floor in px, below which the columns scroll instead of compressing. */
  minWidth: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}
