import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Field text: 16px wherever the pointer is coarse, the design's own size
 * everywhere else. Put on EVERY focusable field in the app — `<input>`,
 * `<textarea>` and `<select>` alike, including the ones that don't come from
 * this file.
 *
 * iOS Safari zooms the whole page in when a field it is focusing renders text
 * below 16px, and it never zooms back out — so a single tap on any field
 * rescales the layout mid-typing, with the caret often ending up off-screen.
 *
 * Two decisions worth keeping:
 *
 * - Keyed on pointer type, not a width breakpoint. A phone in landscape is
 *   wider than `sm`, so `sm:text-[13.5px]` would re-introduce the zoom exactly
 *   where the viewport is shortest.
 * - Written as an opt-OUT for fine pointers, so a browser that reports no
 *   pointer capability at all keeps the safe 16px rather than inheriting the
 *   zoom.
 *
 * Three sizes because the design uses three: inputs at 13.5px, textareas and
 * search boxes at 13px, dense in-table controls at 12.5px. Class strings are
 * literals on purpose — Tailwind scans source text, so a composed
 * `text-[${n}px]` would never be generated.
 */
export const FIELD_TEXT = "text-[16px] [@media(pointer:fine)]:text-[13.5px]";
/** {@link FIELD_TEXT} at the 13px size — textareas, search boxes, modal fields. */
export const FIELD_TEXT_13 = "text-[16px] [@media(pointer:fine)]:text-[13px]";
/** {@link FIELD_TEXT} at the 12.5px size — in-table selects and dense grids. */
export const FIELD_TEXT_12 = "text-[16px] [@media(pointer:fine)]:text-[12.5px]";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "w-full rounded-md border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-ink",
      FIELD_TEXT,
      "placeholder:text-faint focus:outline-none focus:border-brand focus:ring-[3px] focus:ring-brand/15",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-md border border-[#e2e8f0] bg-white px-3.5 py-3 text-ink leading-relaxed",
      FIELD_TEXT_13,
      "placeholder:text-faint focus:outline-none focus:border-brand focus:ring-[3px] focus:ring-brand/15",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "block text-[12.5px] font-semibold text-[#334155] mb-1.5",
        className,
      )}
      {...props}
    />
  );
}
