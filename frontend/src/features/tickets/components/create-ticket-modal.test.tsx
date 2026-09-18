import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";

/**
 * Leaving the new-ticket form with something in it.
 *
 * The bug: a click an inch wide of the panel closed the dialog and threw the
 * draft away without a word. There are four ways out — the close button,
 * Cancel, Escape and the backdrop — and they all arrive at `requestClose`, so
 * the rule is asserted through all four rather than through the one that was
 * reported.
 *
 * The empty form keeps closing on every one of them. Asking somebody to confirm
 * abandoning a form they never started is just a second click.
 */

const h = vi.hoisted(() => ({ push: vi.fn(), mutateAsync: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/features/auth/context", () => ({
  useAuth: () => ({
    user: { id: 1, name: "M", email: "m@acme.com", role: "user", permissions: ["ticket:create"] },
  }),
}));
vi.mock("@/features/customers/queries", () => ({
  useCustomers: () => ({ data: [{ id: 1, name: "Acme Corp" }] }),
}));
vi.mock("@/features/projects/queries", () => ({ useProjects: () => ({ data: undefined }) }));
vi.mock("@/features/kb/queries", () => ({ useKbSuggest: () => ({ data: [] }) }));
vi.mock("../queries", () => ({
  useCategories: () => ({
    data: [{ id: 5, name: "Software", code: "SOFTWARE", customerId: 1 }],
  }),
  useCreateTicket: () => ({
    mutateAsync: h.mutateAsync,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { CreateTicketModal } from "./create-ticket-modal";

const DISCARD_TITLE = /Throw this away\?/;

function open() {
  const onClose = vi.fn();
  const view = render(<CreateTicketModal open onClose={onClose} />);
  return { onClose, view };
}

/** The overlay is the dialog's parent; clicking IT is the backdrop click. */
function backdropOf(name: RegExp | string): HTMLElement {
  const panel = screen.getByRole("dialog", { name });
  const overlay = panel.parentElement;
  if (!overlay) throw new Error("dialog has no overlay");
  return overlay;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("an untouched form", () => {
  it("closes on a backdrop click, with no question asked", async () => {
    const user = userEvent.setup();
    const { onClose } = open();

    await user.click(backdropOf(/New ticket/));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(DISCARD_TITLE)).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = open();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("a form with something in it", () => {
  /** Type into Subject — the cheapest way to make the draft dirty. */
  async function startWriting(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/Subject/), "printer on fire");
  }

  it("refuses a backdrop click and asks instead", async () => {
    const user = userEvent.setup();
    const { onClose } = open();
    await startWriting(user);

    await user.click(backdropOf(/New ticket/));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(DISCARD_TITLE)).toBeInTheDocument();
    // And the draft is still there behind the question.
    expect(screen.getByLabelText(/Subject/)).toHaveValue("printer on fire");
  });

  it("refuses Escape and asks instead", async () => {
    const user = userEvent.setup();
    const { onClose } = open();
    await startWriting(user);

    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(DISCARD_TITLE)).toBeInTheDocument();
  });

  it("asks on the close button too", async () => {
    const user = userEvent.setup();
    const { onClose } = open();
    await startWriting(user);

    await user.click(screen.getByRole("button", { name: /Close/ }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(DISCARD_TITLE)).toBeInTheDocument();
  });

  it("asks on Cancel too", async () => {
    const user = userEvent.setup();
    const { onClose } = open();
    await startWriting(user);

    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(DISCARD_TITLE)).toBeInTheDocument();
  });

  it("counts an attached file as something worth keeping", async () => {
    // Nothing typed at all — the draft is a file and nothing else, which the
    // obvious `subject || description` test would have called empty.
    const user = userEvent.setup();
    const { onClose } = open();
    const file = new File(["x"], "screenshot.png", { type: "image/png" });
    // The picker's `<input>` is `sr-only` inside its `<label>`, so its
    // accessible name is the drop-zone copy.
    await user.upload(screen.getByLabelText(/Drag files here or/i), file);

    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(DISCARD_TITLE)).toBeInTheDocument();
  });
});

describe("answering the question", () => {
  it("keeps writing: the question goes, the draft stays", async () => {
    const user = userEvent.setup();
    const { onClose } = open();
    await user.type(screen.getByLabelText(/Subject/), "printer on fire");
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: /Keep writing/ }));

    expect(screen.queryByText(DISCARD_TITLE)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Subject/)).toHaveValue("printer on fire");
  });

  it("dismissing the question is also 'keep writing', never 'discard'", async () => {
    // Escape and a backdrop click on the confirmation are ambiguous gestures.
    // They must resolve to the safe answer — the one that loses nothing.
    const user = userEvent.setup();
    const { onClose } = open();
    await user.type(screen.getByLabelText(/Subject/), "printer on fire");
    await user.click(backdropOf(/New ticket/));

    await user.click(backdropOf(/Throw this away\?/));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Subject/)).toHaveValue("printer on fire");
  });

  it("discard: the modal closes", async () => {
    const user = userEvent.setup();
    const { onClose } = open();
    await user.type(screen.getByLabelText(/Subject/), "printer on fire");
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: /^Discard$/ }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("what the next open sees", () => {
  it("is an empty form, with no question left over", async () => {
    // The reset runs on the CLOSED render, so the round trip has to go through
    // `open={false}` — which is also what the app does.
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<CreateTicketModal open onClose={onClose} />);
    await user.type(screen.getByLabelText(/Subject/), "printer on fire");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /^Discard$/ }));

    rerender(<CreateTicketModal open={false} onClose={onClose} />);
    rerender(<CreateTicketModal open onClose={onClose} />);

    expect(screen.getByLabelText(/Subject/)).toHaveValue("");
    expect(screen.queryByText(DISCARD_TITLE)).not.toBeInTheDocument();
  });
});
