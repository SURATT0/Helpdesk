import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import type { Notification } from "@/features/notifications/schemas";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  markRead: vi.fn(),
  markAll: vi.fn(),
  data: { items: [] as Notification[], unread: 0 },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/features/notifications/queries", () => ({
  useNotifications: () => ({ data: h.data }),
  useNotificationStream: () => {},
  useMarkNotificationRead: () => ({ mutate: h.markRead }),
  useMarkAllNotificationsRead: () => ({ mutate: h.markAll }),
}));

import { NotificationsBell } from "./notifications-bell";

const sampleNotif: Notification = {
  id: 7,
  type: "ticket.status_change",
  ticketId: 1042,
  message: "Ticket #1042 moved to resolved",
  readAt: null,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  h.data = { items: [], unread: 0 };
});

describe("NotificationsBell", () => {
  it("shows the unread badge and opens a notification", async () => {
    h.data = { items: [sampleNotif], unread: 1 };
    render(<NotificationsBell />);

    expect(screen.getByText("1")).toBeInTheDocument(); // unread badge
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));

    await userEvent.click(screen.getByText("Ticket #1042 moved to resolved"));
    expect(h.markRead).toHaveBeenCalledWith(7);
    expect(h.push).toHaveBeenCalledWith("/tickets/1042");
  });

  it("renders an empty state with no unread badge", async () => {
    render(<NotificationsBell />);
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });
});
