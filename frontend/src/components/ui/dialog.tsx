"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The modal shell, owned in one place.
 *
 * Six modals used to hand-roll this, and they disagreed about the things a user
 * actually notices: three could not be dismissed with Escape or by clicking the
 * backdrop at all — the close button was the only way out — and three put
 * `role="dialog"` on the full-screen overlay rather than the panel, which tells a
 * screen reader the dialog is the whole viewport. Only one had a focus trap. None
 * stopped the page behind from scrolling, so on a phone a drag near the edge
 * scrolls the list under the modal.
 *
 * This owns all of it: portal, backdrop, Escape, click-outside, Tab cycling,
 * scroll lock, and the aria wiring on the panel where it belongs.
 *
 * The overlay's tint, stacking and padding are separate props rather than one
 * free-form className on purpose. `cn` is a plain join with no tailwind-merge
 * behind it, so a caller passing `bg-ink/45` alongside a built-in `bg-black/30`
 * would leave BOTH classes on the element and let stylesheet order pick the
 * winner. One slot per colliding property means exactly one class is emitted.
 */
export function Dialog({
  open,
  onClose,
  labelledBy,
  label,
  align = "center",
  backdrop = "bg-black/30",
  z = "z-50",
  padding = "sm:p-4",
  width = "w-full",
  panelClassName,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** id of the element naming this dialog — rendered by the caller. */
  labelledBy?: string;
  /** Literal accessible name, for dialogs whose visible title carries no id. */
  label?: string;
  /**
   * `start` for modals tall enough to scroll the overlay — centring those pushes
   * their top out of reach. `center` for anything that fits.
   */
  align?: "center" | "start";
  /** Overlay tint. Replaces the default; do not stack another `bg-*` on it. */
  backdrop?: string;
  /** Stacking context. Raise it for a dialog that can open above another. */
  z?: string;
  /**
   * Overlay padding from `sm` up. The `p-3` mobile floor always applies and is
   * not overridable: the two widest modals used a flat `p-[44px]`, which on a
   * 375px screen left 287px for the overlay and 239px for the form inside it.
   */
  padding?: string;
  /**
   * Panel width. `w-full` fills up to its `max-w`, which is what a form
   * wants; `w-auto` shrink-wraps the content, which is what an image
   * preview wants. Its own slot because it would collide with `w-full`.
   */
  width?: string;
  panelClassName?: string;
  children: React.ReactNode;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);

  // A portal needs a DOM to aim at, so nothing renders on the server pass.
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Freeze the page behind. Restoring the previous value rather than clearing it
  // keeps back-to-back modals from leaving the body permanently stuck.
  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function onPanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={cn(
        // Portalled to <body>, so `fixed` cannot be re-based by a transformed
        // ancestor somewhere up the page tree.
        "fixed inset-0 grid justify-center overflow-y-auto p-3",
        z,
        backdrop,
        padding,
        align === "start" ? "place-items-start" : "place-items-center",
      )}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        className={cn(width, panelClassName)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onPanelKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
