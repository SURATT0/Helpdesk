import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("renders the human label for a status enum", () => {
    render(<StatusBadge status="in_progress" />); // a DERIVED value
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("adds a caret only when requested", () => {
    // `open` is a historical word: no ticket is stored that way any more, but a
    // timeline row written before the three-value model still says it.
    const { rerender } = render(<StatusBadge status="open" />);
    expect(screen.queryByText("▾")).not.toBeInTheDocument();
    rerender(<StatusBadge status="open" caret />);
    expect(screen.getByText("▾")).toBeInTheDocument();
  });
});
