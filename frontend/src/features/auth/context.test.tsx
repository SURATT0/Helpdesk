import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("./api", () => ({
  bootstrapSession: h.bootstrap,
  login: h.login,
  logout: h.logout,
}));

import { AuthProvider, useAuth } from "./context";

const agent = {
  id: 1,
  name: "Dana Reyes",
  email: "dana.reyes@acme.com",
  role: "admin",
  teamId: 1,
  availableForAssignment: true,
};
const requester = { ...agent, id: 4, name: "Marcus Chen", role: "user" };

/** The key shape the ticket list uses — no signed-in user anywhere in it. */
const TICKET_LIST = ["tickets", "list", {}] as const;
const OTHER_PEOPLES_TICKETS = [{ id: 1001, requester: "T. Alvarez" }];

function Screen() {
  const { status, user, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="who">{user ? user.name : status}</span>
      <button onClick={() => void login("marcus.chen@acme.com", "password123")}>
        sign in
      </button>
      <button onClick={() => void logout()}>sign out</button>
    </div>
  );
}

function mount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(TICKET_LIST, OTHER_PEOPLES_TICKETS);
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Screen />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.bootstrap.mockResolvedValue(agent);
  h.login.mockResolvedValue(requester);
  h.logout.mockResolvedValue(undefined);
});

describe("AuthProvider", () => {
  it("drops the cached queries when someone signs in", async () => {
    const queryClient = mount();
    await waitFor(() =>
      expect(screen.getByTestId("who")).toHaveTextContent("Dana Reyes"),
    );
    // The cache is warm and its keys say nothing about whose data it holds.
    expect(queryClient.getQueryData(TICKET_LIST)).toEqual(OTHER_PEOPLES_TICKETS);

    await userEvent.click(screen.getByRole("button", { name: "sign in" }));

    await waitFor(() =>
      expect(screen.getByTestId("who")).toHaveTextContent("Marcus Chen"),
    );
    // Without this, the requester's ticket list renders the agent's rows for the
    // first 30 seconds (staleTime) without even attempting a refetch.
    expect(queryClient.getQueryData(TICKET_LIST)).toBeUndefined();
  });

  it("drops them on the way out too, before the next session starts", async () => {
    const queryClient = mount();
    await waitFor(() =>
      expect(screen.getByTestId("who")).toHaveTextContent("Dana Reyes"),
    );

    await userEvent.click(screen.getByRole("button", { name: "sign out" }));

    await waitFor(() =>
      expect(screen.getByTestId("who")).toHaveTextContent("unauthenticated"),
    );
    expect(queryClient.getQueryData(TICKET_LIST)).toBeUndefined();
  });
});
