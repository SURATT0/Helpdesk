import { describe, it, expect, vi } from "vitest";
import {
  LocalEventBus,
  buildRedisOptions,
  type CommentCreatedEvent,
} from "./events";

// A minimal, type-correct comment.created payload.
const event = (ticketId: number): CommentCreatedEvent => ({
  ticketId,
  comment: {
    id: 1,
    body: "hello",
    internal: false,
    channel: "web",
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

describe("buildRedisOptions", () => {
  it("queues commands across reconnects and never gives up rejoining", () => {
    const o = buildRedisOptions({ url: "redis://localhost:6379" });
    expect(o.maxRetriesPerRequest).toBeNull();
    // retryStrategy returns a delay (a number) for every attempt → keeps retrying.
    const strat = o.retryStrategy as (times: number) => number;
    expect(strat(1)).toBe(200);
    expect(strat(999)).toBe(5000); // capped at 5s
  });

  it("reconnects on a failover READONLY reply, not on other errors", () => {
    const o = buildRedisOptions({ url: "redis://localhost:6379" });
    const onErr = o.reconnectOnError as (e: Error) => boolean;
    expect(onErr(new Error("READONLY You can't write against a read only replica"))).toBe(true);
    expect(onErr(new Error("some other error"))).toBe(false);
  });

  it("enables TLS for a rediss:// URL (verified by default)", () => {
    const o = buildRedisOptions({ url: "rediss://redis.example.com:6379" });
    expect(o.tls).toEqual({ rejectUnauthorized: true });
  });

  it("forces TLS for a redis:// URL when tls is set", () => {
    const o = buildRedisOptions({ url: "redis://host:6379", tls: true });
    expect(o.tls).toEqual({ rejectUnauthorized: true });
  });

  it("leaves TLS off for a plain redis:// URL", () => {
    const o = buildRedisOptions({ url: "redis://host:6379" });
    expect(o.tls).toBeUndefined();
  });

  it("can disable certificate verification explicitly", () => {
    const o = buildRedisOptions({
      url: "rediss://host:6379",
      tlsRejectUnauthorized: false,
    });
    expect(o.tls).toEqual({ rejectUnauthorized: false });
  });

  it("passes through username + password when provided", () => {
    const o = buildRedisOptions({
      url: "redis://host:6379",
      username: "deskly",
      password: "s3cret",
    });
    expect(o.username).toBe("deskly");
    expect(o.password).toBe("s3cret");
  });
});
