import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";

vi.mock("@/features/auth/context", () => ({
  useAuth: () => ({
    user: { id: 1, name: "Dana", email: "dana@acme.com", role: "admin" },
  }),
}));
vi.mock("../queries", () => ({
  useCreateComment: () => ({ mutate: vi.fn(), isPending: false }),
  useSendReply: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/features/attachments/queries", () => ({
  useUploadAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../api", () => ({ sendTyping: vi.fn() }));

import { Composer } from "./composer";

const props = {
  ticketId: 1042,
  requester: "Marcus Chen",
  requesterEmail: "marcus.chen@acme.com",
  canAddNote: true,
};

describe("Composer", () => {
  it("offers chat, email reply and note on a requester's ticket", () => {
    render(<Composer {...props} />);

    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Internal note" }),
    ).toBeInTheDocument();
    // Chat is the live tab, so the box is addressed to the requester.
    expect(
      screen.getByPlaceholderText(/Message Marcus/),
    ).toBeInTheDocument();
  });

  it("offers only the note when the desk raised the ticket itself", () => {
    render(<Composer {...props} internalOnly />);

    expect(screen.queryByRole("button", { name: "Chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Internal note" }),
    ).toBeInTheDocument();
    // The note is live without being clicked — there is no other tab to be on.
    expect(
      screen.getByPlaceholderText(/Add an internal note/),
    ).toBeInTheDocument();
    // And the absence is explained, rather than reading as a broken toolbar.
    expect(screen.getByText(/Raised by the desk/)).toBeInTheDocument();
  });

  it("keeps the chat box for a viewer who cannot write notes at all", () => {
    // Defensive: a requester cannot see a staff-raised ticket, so this pairing
    // should not arise — but dropping every tab would leave no composer.
    render(<Composer {...props} canAddNote={false} internalOnly />);

    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Internal note" })).toBeNull();
  });
});
