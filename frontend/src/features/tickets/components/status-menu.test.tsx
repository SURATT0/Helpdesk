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

    // Both options out of `new` finish the work, so neither patches straight
    // away — they ask what was done first. See `requiresResolution`.
    await userEvent.click(screen.getByText("Pending"));
    expect(h.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("What did you do?")).toBeInTheDocument();
  });

  it("will not submit a finish with nothing written in it", async () => {
    render(<StatusMenu ticket={ticket} />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("Pending"));

    // The requirement is visible before the click rather than arriving as a
    // 400 afterwards; the server checks it too, twice, as the backstop.
    expect(screen.getByRole("button", { name: "Send to requester" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("How it was fixed"), "   ");
    expect(screen.getByRole("button", { name: "Send to requester" })).toBeDisabled();
  });

  it("sends what was typed along with the status change", async () => {
    render(<StatusMenu ticket={ticket} />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("Pending"));

    await userEvent.type(
      screen.getByLabelText("How it was fixed"),
      "Replaced the switch on desk 4.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send to requester" }));

    expect(h.mutate).toHaveBeenCalledWith(
      {
        id: 1042,
        status: "pending",
        resolution: "Replaced the switch on desk 4.",
      },
      expect.anything(),
    );
  });

  it("reopens without asking — nothing has been finished", async () => {
    // closed → new is not a finish, so it writes straight through. Keyed on the
    // PAIR, which is what stops "any move to closed must explain itself" from
    // catching the requester's confirmation too.
    const closed = {
      id: 1042,
      status: "closed",
      displayStatus: "closed",
    } as unknown as Ticket;
    render(<StatusMenu ticket={closed} />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("New"));

    expect(screen.queryByText("What did you do?")).not.toBeInTheDocument();
    expect(h.mutate).toHaveBeenCalledWith({ id: 1042, status: "new" });
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
