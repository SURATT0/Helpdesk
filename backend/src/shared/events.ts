import { EventEmitter } from "node:events";
import Redis from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";
import type { CommentDto } from "../modules/comments/comment.repository";

/** Payload broadcast when a comment (chat / reply / note) is created. */
export type CommentCreatedEvent = { ticketId: number; comment: CommentDto };

/** The event catalogue: event name → payload shape. */
export type Events = {
  "comment.created": CommentCreatedEvent;
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

  constructor(url: string) {
    this.local.setMaxListeners(0);
    this.pub = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
    this.sub = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
    this.pub.on("error", (e) => logger.error({ err: e }, "redis publisher error"));
    this.sub.on("error", (e) => logger.error({ err: e }, "redis subscriber error"));
    this.sub.subscribe(this.channel).catch((e) =>
      logger.error({ err: e }, "redis subscribe failed"),
    );
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
    logger.info("event bus: redis pub/sub enabled");
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
}

/** Env-selected singleton. REDIS_URL set → cross-instance; unset → in-process. */
export const bus: IEventBus = env.redisUrl
  ? new RedisEventBus(env.redisUrl)
  : new LocalEventBus();
