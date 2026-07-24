import { EventEmitter } from "node:events";
import Redis, { type RedisOptions } from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";
import type { CommentDto } from "../modules/comments/comment.repository";

/** Payload broadcast when a comment (chat / reply / note) is created. */
export type CommentCreatedEvent = { ticketId: number; comment: CommentDto };

/** Payload broadcast while a user is actively typing in a ticket's chat. */
export type TypingEvent = { ticketId: number; userId: number; name: string };

/** Payload broadcast when a user reads a ticket's chat up to a comment id. */
export type ReadEvent = {
  ticketId: number;
  userId: number;
  name: string;
  lastReadId: number;
};

/** Broadcast when a notification is created for a user (a refetch signal). */
export type NotificationCreatedEvent = { userId: number };

/** The event catalogue: event name → payload shape. */
export type Events = {
  "comment.created": CommentCreatedEvent;
  typing: TypingEvent;
  read: ReadEvent;
  "notification.created": NotificationCreatedEvent;
};

type Listener<K extends keyof Events> = (payload: Events[K]) => void;

/**
 * Pub/sub for real-time fan-out to SSE subscribers. Two interchangeable drivers
 * (mirrors the IFileStorage pattern): an in-process bus for single-node dev, and
 * a Redis-backed bus for multi-instance deployments — chosen by REDIS_URL. The
 * emit/on/off surface is identical, so publishers/subscribers never change.
 */
export interface IEventBus {
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
  on<K extends keyof Events>(event: K, listener: Listener<K>): void;
  off<K extends keyof Events>(event: K, listener: Listener<K>): void;
  /** Release connections on shutdown. No-op for the in-process bus. */
  close(): Promise<void>;
}

/** Single-node: deliver straight to in-process listeners. */
export class LocalEventBus implements IEventBus {
  private readonly ee = new EventEmitter();
  constructor() {
    this.ee.setMaxListeners(0); // one listener per open SSE stream
  }
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.ee.emit(event, payload);
  }
  on<K extends keyof Events>(event: K, listener: Listener<K>): void {
    this.ee.on(event, listener as (payload: unknown) => void);
  }
  off<K extends keyof Events>(event: K, listener: Listener<K>): void {
    this.ee.off(event, listener as (payload: unknown) => void);
  }
  async close(): Promise<void> {
    this.ee.removeAllListeners();
  }
}

/** Connection settings for the Redis-backed bus. */
export type RedisConnConfig = {
  url: string;
  username?: string;
  password?: string;
  /** Force TLS even for a redis:// URL (rediss:// enables it automatically). */
  tls?: boolean;
  /** Verify the server certificate (default true). */
  tlsRejectUnauthorized?: boolean;
};

/**
 * ioredis options tuned for production, kept pure/exported for testing:
 * - commands queue across a reconnect instead of failing (`maxRetriesPerRequest`
 *   null) so a `publish` during a blip isn't lost;
 * - a capped exponential backoff that never gives up rejoining the cluster;
 * - reconnect on a failover's READONLY reply (old primary demoted to replica);
 * - TLS + auth from config.
 */
export function buildRedisOptions(cfg: RedisConnConfig): RedisOptions {
  const useTls = cfg.tls || cfg.url.startsWith("rediss://");
  const options: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(times * 200, 5000),
    reconnectOnError: (err: Error) => err.message.includes("READONLY"),
  };
  if (cfg.username) options.username = cfg.username;
  if (cfg.password) options.password = cfg.password;
  if (useTls) {
    options.tls = { rejectUnauthorized: cfg.tlsRejectUnauthorized !== false };
  }
  return options;
}

/**
 * Multi-instance: publish to a Redis channel; every instance (including the
 * publisher) receives it on its subscriber connection and dispatches to its own
 * local listeners — so each SSE client is served by whichever node holds its
 * connection. Redis pub/sub needs a dedicated subscriber connection, hence two
 * clients. Delivery is at-most-once (fine for chat; a focus-refetch reconciles).
 */
export class RedisEventBus implements IEventBus {
  private readonly local = new EventEmitter();
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly channel = "deskly:events";

  constructor(cfg: RedisConnConfig) {
    this.local.setMaxListeners(0);
    const options = buildRedisOptions(cfg);
    this.pub = new Redis(cfg.url, options);
    this.sub = new Redis(cfg.url, options);
    this.instrument(this.pub, "publisher");
    this.instrument(this.sub, "subscriber");

    // (Re)subscribe on every `ready` — this fires on the first connect AND after
    // each reconnect, so a dropped subscriber automatically rejoins the channel.
    this.sub.on("ready", () => {
      this.sub
        .subscribe(this.channel)
        .catch((e) => logger.error({ err: e }, "redis subscribe failed"));
    });
    this.sub.on("message", (_channel, raw) => {
      try {
        const { event, payload } = JSON.parse(raw) as {
          event: keyof Events;
          payload: unknown;
        };
        this.local.emit(event, payload);
      } catch (e) {
        logger.warn({ err: e }, "dropped malformed redis event");
      }
    });
    logger.info({ tls: Boolean(options.tls) }, "event bus: redis pub/sub enabled");
  }

  /** Log the connection lifecycle so reconnects/failovers are observable. */
  private instrument(client: Redis, role: string): void {
    client.on("error", (e) => logger.error({ err: e, role }, "redis error"));
    client.on("reconnecting", (ms: number) =>
      logger.warn({ role, delayMs: ms }, "redis reconnecting"),
    );
    client.on("end", () => logger.warn({ role }, "redis connection ended"));
    client.on("ready", () => logger.info({ role }, "redis connection ready"));
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    // Publish only — the message comes back to us via `sub` and is dispatched
    // there, so every node (self included) delivers it exactly once.
    void this.pub
      .publish(this.channel, JSON.stringify({ event, payload }))
      .catch((e) => logger.error({ err: e }, "redis publish failed"));
  }
  on<K extends keyof Events>(event: K, listener: Listener<K>): void {
    this.local.on(event, listener as (payload: unknown) => void);
  }
  off<K extends keyof Events>(event: K, listener: Listener<K>): void {
    this.local.off(event, listener as (payload: unknown) => void);
  }
  /** Quit both connections cleanly (drains in-flight commands). */
  async close(): Promise<void> {
    this.local.removeAllListeners();
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}

/** Env-selected singleton. REDIS_URL set → cross-instance; unset → in-process. */
export const bus: IEventBus = env.redis.url
  ? new RedisEventBus({
      url: env.redis.url,
      username: env.redis.username,
      password: env.redis.password,
      tls: env.redis.tls,
      tlsRejectUnauthorized: env.redis.tlsRejectUnauthorized,
    })
  : new LocalEventBus();
