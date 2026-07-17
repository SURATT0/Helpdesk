import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("renders the human label for a status enum", () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("adds a caret only when requested", () => {
    const { rerender } = render(<StatusBadge status="open" />);
    expect(screen.queryByText("▾")).not.toBeInTheDocument();
    rerender(<StatusBadge status="open" caret />);
    expect(screen.getByText("▾")).toBeInTheDocument();
  });
});
