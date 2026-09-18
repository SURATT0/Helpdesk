import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Dialog } from "./dialog";

/**
 * The page behind a dialog stays still, and starts moving again when the last
 * dialog goes — not when the first one does.
 *
 * Each Dialog used to remember the body's `overflow` for itself and put it back
 * on the way out. With one dialog that is right. With two, the inner one
 * remembers `hidden` (the outer one's doing) and the outer one remembers `""`,
 * so whichever cleanup React runs last decides — and when both closed in the
 * same commit the page could be left frozen with no dialog on screen at all.
 * Observed in the browser: `body.style.overflow` still `hidden`, zero dialogs
 * in the DOM, nothing scrollable until a reload.
 */

function Panel({ open, label }: { open: boolean; label: string }) {
  return (
    <Dialog open={open} onClose={() => {}} label={label}>
      <p>{label}</p>
    </Dialog>
  );
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("the body scroll lock", () => {
  it("freezes the page while a dialog is open and frees it after", () => {
    const { rerender } = render(<Panel open label="only" />);
    expect(document.body.style.overflow).toBe("hidden");

    rerender(<Panel open={false} label="only" />);
    expect(document.body.style.overflow).toBe("");
  });

  it("stays frozen while a second dialog is open over the first", () => {
    render(<Panel open label="outer" />);
    render(<Panel open label="inner" />);
    expect(screen.getAllByRole("dialog")).toHaveLength(2);

    expect(document.body.style.overflow).toBe("hidden");
  });

  it("frees the page only when the LAST dialog closes", () => {
    const outer = render(<Panel open label="outer" />);
    const inner = render(<Panel open label="inner" />);

    // The one on top goes first — the usual case, dismissing a confirmation.
    inner.unmount();
    expect(document.body.style.overflow).toBe("hidden");

    outer.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("survives the two closing in the other order", () => {
    // The order that used to strand the page: whichever cleanup React runs
    // last wrote the answer, and the inner one's answer was `hidden`.
    const outer = render(<Panel open label="outer" />);
    const inner = render(<Panel open label="inner" />);

    outer.unmount();
    inner.unmount();

    expect(document.body.style.overflow).toBe("");
  });

  it("puts back whatever the page had before, not a blank", () => {
    // A page that was already `overflow: hidden` for its own reasons must stay
    // that way — the lock is a loan, not an assignment.
    document.body.style.overflow = "clip";
    const { rerender } = render(<Panel open label="only" />);
    expect(document.body.style.overflow).toBe("hidden");

    rerender(<Panel open={false} label="only" />);
    expect(document.body.style.overflow).toBe("clip");
  });
});
