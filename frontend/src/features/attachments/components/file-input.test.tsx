import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { FileInput } from "./file-input";
import { ACCEPTED_TYPES } from "../accept";

/**
 * The shape of this control is the fix, so the shape is what is asserted.
 *
 * Every attachment surface used to be a `<button>` calling `.click()` on an
 * `<input type="file" class="hidden">`. That works on a desktop browser and does
 * NOTHING on iOS Safari — a `display: none` file input ignores a programmatic
 * click — so on a phone the picker never opened and the camera was the only way
 * to attach anything.
 *
 * No test we can run in jsdom reproduces that: jsdom has no picker to open. What
 * a test CAN pin is the two properties that make the bug impossible, and they
 * are both structural. If someone reaches for `hidden` again, or puts the input
 * back outside the label, these fail.
 */

describe("the picker can actually be opened", () => {
  it("keeps the input in the layout rather than display:none", () => {
    render(
      <FileInput onFiles={() => {}}>
        <span>Attach</span>
      </FileInput>,
    );
    const input = document.querySelector("input[type=file]");
    expect(input).not.toBeNull();
    // `hidden` is Tailwind's display:none, and display:none is the whole bug.
    expect(input!.className).not.toMatch(/\bhidden\b/);
    // `sr-only` hides it the accessible way: clipped to 1px, still laid out.
    expect(input!.className).toMatch(/\bsr-only\b/);
  });

  it("puts the input inside the label, so activation needs no JavaScript", () => {
    render(
      <FileInput onFiles={() => {}}>
        <span>Attach</span>
      </FileInput>,
    );
    const input = document.querySelector("input[type=file]")!;
    // A label wrapping its control is what makes a click on the visible chrome
    // open the picker natively. Nothing calls .click(), so nothing can ignore it.
    expect(input.closest("label")).not.toBeNull();
    expect(screen.getByText("Attach").closest("label")).toBe(
      input.closest("label"),
    );
  });
});

describe("what it offers", () => {
  it("accepts exactly the types the API accepts", () => {
    render(<FileInput onFiles={() => {}}>pick</FileInput>);
    const input = document.querySelector("input[type=file]")!;
    // Mirrors the server's allowlist. `image/*` is deliberately absent: it lets
    // a picker offer HEIC, which the API refuses AFTER the person has chosen it.
    expect(input.getAttribute("accept")).toBe(ACCEPTED_TYPES.join(","));
  });

  it("takes several files by default, and one when asked", () => {
    const { unmount } = render(<FileInput onFiles={() => {}}>pick</FileInput>);
    expect(document.querySelector("input[type=file]")).toHaveAttribute("multiple");
    unmount();

    render(
      <FileInput onFiles={() => {}} multiple={false}>
        pick
      </FileInput>,
    );
    expect(document.querySelector("input[type=file]")).not.toHaveAttribute(
      "multiple",
    );
  });

  it("asks for the rear camera only when told to", () => {
    const { unmount } = render(<FileInput onFiles={() => {}}>pick</FileInput>);
    // No `capture` on the ordinary picker: with it, a phone opens the camera
    // INSTEAD of the file browser, which is the opposite of what was wrong.
    expect(document.querySelector("input[type=file]")).not.toHaveAttribute(
      "capture",
    );
    unmount();

    render(
      <FileInput onFiles={() => {}} capture="environment">
        photo
      </FileInput>,
    );
    expect(document.querySelector("input[type=file]")).toHaveAttribute(
      "capture",
      "environment",
    );
  });
});

describe("choosing files", () => {
  it("hands every chosen file to the caller", async () => {
    const onFiles = vi.fn();
    render(<FileInput onFiles={onFiles}>pick</FileInput>);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;

    await userEvent.upload(input, [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.pdf", { type: "application/pdf" }),
    ]);

    expect(onFiles).toHaveBeenCalledTimes(1);
    const picked = onFiles.mock.calls[0][0] as FileList;
    expect([...picked].map((f) => f.name)).toEqual(["a.png", "b.pdf"]);
  });

  it("clears itself, so picking the same file twice still fires", async () => {
    const onFiles = vi.fn();
    render(<FileInput onFiles={onFiles}>pick</FileInput>);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["a"], "a.png", { type: "image/png" });

    await userEvent.upload(input, file);
    // The value is reset in the change handler; without it the second pick of an
    // identical file is not a change and the event never arrives.
    expect(input.value).toBe("");

    await userEvent.upload(input, file);
    expect(onFiles).toHaveBeenCalledTimes(2);
  });
});
