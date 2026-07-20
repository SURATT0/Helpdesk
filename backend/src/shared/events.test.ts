import { describe, it, expect, vi } from "vitest";
import { LocalEventBus, type CommentCreatedEvent } from "./events";

// A minimal, type-correct comment.created payload.
const event = (ticketId: number): CommentCreatedEvent => ({
  ticketId,
  comment: {
    id: 1,
    body: "hello",
    internal: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    author: { id: 2, name: "Dana Reyes", role: "agent" },
  },
});

describe("LocalEventBus", () => {
  it("delivers an emitted event to a subscribed listener", () => {
    const bus = new LocalEventBus();
    const listener = vi.fn();
    bus.on("comment.created", listener);

    const payload = event(1042);
    bus.emit("comment.created", payload);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(payload);
  });

  it("fans out to every subscribed listener", () => {
    const bus = new LocalEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("comment.created", a);
    bus.on("comment.created", b);

    bus.emit("comment.created", event(1));

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after off()", () => {
    const bus = new LocalEventBus();
    const listener = vi.fn();
    bus.on("comment.created", listener);
    bus.off("comment.created", listener);

    bus.emit("comment.created", event(1));

    expect(listener).not.toHaveBeenCalled();
  });

  it("only removes the listener passed to off(), leaving others attached", () => {
    const bus = new LocalEventBus();
    const kept = vi.fn();
    const removed = vi.fn();
    bus.on("comment.created", kept);
    bus.on("comment.created", removed);
    bus.off("comment.created", removed);

    bus.emit("comment.created", event(1));

    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it("does not throw when emitting with no listeners", () => {
    const bus = new LocalEventBus();
    expect(() => bus.emit("comment.created", event(1))).not.toThrow();
  });
});
