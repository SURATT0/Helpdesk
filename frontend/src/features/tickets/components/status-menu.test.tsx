import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import type { Ticket } from "../schemas";

// Mutable mock state (hoisted so the vi.mock factories can close over it).
const h = vi.hoisted(() => ({ mutate: vi.fn(), role: "agent" as string }));

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

const ticket = { id: 1042, status: "open" } as unknown as Ticket;

beforeEach(() => {
  vi.clearAllMocks();
  h.role = "agent";
});

describe("StatusMenu", () => {
  it("lets a write-capable role pick an allowed transition", async () => {
    render(<StatusMenu ticket={ticket} />);
    await userEvent.click(screen.getByRole("button"));

    // open → [in_progress, pending, resolved]
    expect(screen.getByText("Move to")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Pending"));
    expect(h.mutate).toHaveBeenCalledWith({ id: 1042, status: "pending" });
  });

  it("shows a plain badge (no menu) for a requester", () => {
    h.role = "requester";
    render(<StatusMenu ticket={ticket} />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Move to")).not.toBeInTheDocument();
  });
});
