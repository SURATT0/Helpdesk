import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "w-full rounded-md border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-[13.5px] text-ink",
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
      "w-full rounded-md border border-[#e2e8f0] bg-white px-3.5 py-3 text-[13px] text-ink leading-relaxed",
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
