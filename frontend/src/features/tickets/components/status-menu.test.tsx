import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import type { Ticket } from "../schemas";

// Mutable mock state (hoisted so the vi.mock factories can close over it).
const h = vi.hoisted(() => ({ mutate: vi.fn(), role: "admin" as string }));

vi.mock("@/features/auth/context", () => ({
  useAuth: () => ({
    user: { id: 1, name: "Dana", email: "d@acme.com", role: h.role, teamId: 1 },
  }),
}));
vi.mock("../queries", () => ({
  useUpdateTicketStatus: () => ({
    mutate: h.mutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { StatusMenu } from "./status-menu";

// Both statuses, because the menu reads both: the badge shows `displayStatus`,
// the options come from the transitions of the stored `status`.
// Stored `new` with nobody on it, so it reads as New; the menu's options come
// from the transitions of the stored value.
const ticket = {
  id: 1042,
  status: "new",
  displayStatus: "new",
} as unknown as Ticket;

beforeEach(() => {
  vi.clearAllMocks();
  h.role = "admin";
});

describe("StatusMenu", () => {
  it("lets a write-capable role pick an allowed transition", async () => {
    render(<StatusMenu ticket={ticket} />);
    await userEvent.click(screen.getByRole("button"));

    // new → [pending, closed]. "In Progress" is not offered here at all: it is
    // what assigning the ticket does, not a status to move it to.
    expect(screen.getByText("Move to")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.queryByText("In Progress")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Pending"));
    expect(h.mutate).toHaveBeenCalledWith({ id: 1042, status: "pending" });
  });

  it("shows a plain badge (no menu) for a requester", () => {
    h.role = "user";
    render(<StatusMenu ticket={ticket} />);
    // The DERIVED label, not the column value: this ticket is stored `open` with
    // nobody on it, which is New to a reader.
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Move to")).not.toBeInTheDocument();
  });
});
