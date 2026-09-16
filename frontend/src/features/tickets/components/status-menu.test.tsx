import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import type { Ticket } from "../schemas";

// Mutable mock state (hoisted so the vi.mock factories can close over it).
//
// `permissions`, not `role`, is what the menu now reads — it is the list the
// server sends on the session, so a test that set a role name would be testing
// a question nothing asks any more.
const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  permissions: ["ticket:read", "ticket:write"] as string[],
}));

vi.mock("@/features/auth/context", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      name: "Dana",
      email: "d@acme.com",
      role: "admin",
      teamId: 1,
      permissions: h.permissions,
    },
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
  h.permissions = ["ticket:read", "ticket:write"];
});

describe("StatusMenu", () => {
  it("lets someone holding ticket:write pick an allowed transition", async () => {
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

  it("shows a plain badge (no menu) without ticket:write", () => {
    h.permissions = ["ticket:read", "ticket:create"];
    render(<StatusMenu ticket={ticket} />);
    // The DERIVED label, not the column value: this ticket is stored `open` with
    // nobody on it, which is New to a reader.
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Move to")).not.toBeInTheDocument();
  });

  it("follows the matrix, not the role name", async () => {
    // The regression this file is the guard for. The viewer is still an `admin`
    // — the mock never changes that — but the matrix no longer grants their role
    // `ticket:write`, and the control has to go. The old check was
    // `["super_admin", "admin"].includes(user.role)`, which left the dropdown up
    // and 403'd on every choice in it.
    h.permissions = ["ticket:read", "ticket:create"];
    render(<StatusMenu ticket={ticket} />);
    expect(screen.queryByText("Move to")).not.toBeInTheDocument();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("offers the control to a role the matrix has just widened", async () => {
    // And the direction the role list could not express at all: a desk that
    // decides its requesters may work their own tickets.
    h.permissions = ["ticket:read", "ticket:create", "ticket:write"];
    render(<StatusMenu ticket={ticket} />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Move to")).toBeInTheDocument();
  });
});
