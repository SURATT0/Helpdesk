"use client";

import * as React from "react";
import { ATTACHMENT_ACCEPT } from "../accept";
import { cn } from "@/lib/utils";

/**
 * A file picker that actually opens.
 *
 * Every attachment surface used to do the same thing: a `<button>` whose
 * onClick called `inputRef.current?.click()` on an `<input type="file">` that
 * was `className="hidden"`. On a desktop browser that works, which is why it
 * survived every test we have. On iOS Safari — and in the in-app browsers that
 * embed it, and some Android WebViews — **a file input that is `display: none`
 * does not respond to a programmatic `.click()` at all**. The picker simply
 * never opened, so the only way left to attach anything was the camera.
 *
 * Two things fix it, and this component is both:
 *
 *   - The input stays in the render tree. `sr-only` hides it the way an
 *     accessible name is hidden — `position: absolute` and a 1px clip — rather
 *     than removing it from layout, so the element is still something a browser
 *     will open a picker for.
 *   - Activation is native. The input lives INSIDE a `<label>`, so clicking
 *     anywhere on the label opens the picker with no JavaScript in the path.
 *     There is no `.click()` left to be ignored.
 *
 * The visible chrome is the caller's: a dashed drop zone in the create form, a
 * small button in the composer. What is shared is the mechanism, because the
 * mechanism is what was broken in all three.
 */
export function FileInput({
  onFiles,
  multiple = true,
  capture,
  disabled,
  className,
  children,
  ...rest
}: {
  /** Called with whatever was picked. The input is cleared afterwards, so
   *  choosing the same file twice in a row still fires. */
  onFiles: (files: FileList | null) => void;
  multiple?: boolean;
  /**
   * Ask for the device camera rather than its files.
   *
   * `"environment"` is the rear camera. Only meaningful on a device that has
   * one; a desktop browser ignores the attribute, which is why the caller
   * decides whether to render a camera button at all rather than this
   * component guessing.
   */
  capture?: "environment" | "user";
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
} & Pick<
  React.LabelHTMLAttributes<HTMLLabelElement>,
  "onDragOver" | "onDragLeave" | "onDrop" | "title"
>) {
  return (
    <label
      // `relative` so the absolutely-positioned input is clipped against this
      // label rather than escaping to the nearest positioned ancestor.
      //
      // `has-[:focus-visible]` for the ring: the input is the focusable element
      // and it is invisible, so without this a keyboard user tabs to a control
      // that shows no sign of having focus. The label wears the ring on its
      // behalf. Not `peer-*`, which styles a following SIBLING — the input is a
      // child here, and the parent is what has to show the focus.
      className={cn(
        "relative",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
        className,
      )}
      {...rest}
    >
      {children}
      <input
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple={multiple}
        capture={capture}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          onFiles(e.target.files);
          // So picking the same file again still fires a change event.
          e.target.value = "";
        }}
      />
    </label>
  );
}
