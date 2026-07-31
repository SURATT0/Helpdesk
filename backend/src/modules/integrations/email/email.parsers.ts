import type { Priority } from "../../../shared/domain";
import { BadRequest } from "../../../shared/errors";
import type { InboundEmail } from "./email.types";

/**
 * Split a From value into address + optional display name. Handles both bare
 * addresses (`dana@acme.com`) and RFC-style `Dana Reyes <dana@acme.com>`.
 */
export function parseEmailAddress(raw: string): {
  email: string;
  name?: string;
} {
  const trimmed = (raw ?? "").trim();
  const angled = trimmed.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angled) {
    const name = angled[1].trim();
    return { email: angled[2].trim().toLowerCase(), name: name || undefined };
  }
  return { email: trimmed.toLowerCase() };
}

/**
 * Derive a priority from a subject prefix tag like `[urgent]` / `[high]`.
 * Falls back to medium. Returns the (possibly untouched) subject with a leading
 * recognised tag stripped so it doesn't clutter the ticket title.
 */
export function derivePriority(subject: string): {
  priority: Priority;
  subject: string;
} {
  const m = subject.match(/^\s*\[(urgent|critical|high|medium|low)\]\s*/i);
  if (!m) return { priority: "medium", subject: subject.trim() };
  const tag = m[1].toLowerCase();
  const priority: Priority = tag === "urgent" ? "critical" : (tag as Priority);
  return { priority, subject: subject.slice(m[0].length).trim() };
}

/**
 * The ticket reference carried in every outbound reply subject, e.g. `[#42]`.
 * ONE definition drives both directions — `ensureTicketRef` writes it on the way
 * out and `parseTicketRef` reads it on the way back in — so the token can never
 * drift out of sync and silently stop threading.
 */
const TICKET_REF_RE = /\[#(\d{1,10})\]/;

/** Format the reference tag for a ticket id. */
export function ticketRef(ticketId: number): string {
  return `[#${ticketId}]`;
}

/**
 * Guarantee a subject carries its ticket reference, without duplicating one that
 * is already there (a long `Re: Re:` chain must not accrete tags). Returns the
 * subject unchanged when the correct ref is already present.
 */
export function ensureTicketRef(subject: string, ticketId: number): string {
  const trimmed = subject.trim();
  const found = trimmed.match(TICKET_REF_RE);
  if (found && Number(found[1]) === ticketId) return trimmed;
  return `${ticketRef(ticketId)} ${trimmed}`.trim();
}

/**
 * Read a ticket reference out of a reply subject. Returns the id plus the
 * subject with the tag removed (so a ticket created from an unmatched reply
 * doesn't keep a stale `[#…]` in its title).
 *
 * A subject match is a HINT, never authorization: the sender is free to type any
 * id, so `emailService.ingest` still checks the sender may post on that ticket.
 */
export function parseTicketRef(subject: string): {
  ticketId: number | null;
  subject: string;
} {
  const m = (subject ?? "").match(TICKET_REF_RE);
  if (!m) return { ticketId: null, subject: (subject ?? "").trim() };
  const id = Number(m[1]);
  const stripped = subject.replace(m[0], " ").replace(/\s+/g, " ").trim();
  return {
    ticketId: Number.isSafeInteger(id) && id > 0 ? id : null,
    subject: stripped,
  };
}

const asString = (v: unknown): string =>
  typeof v === "string" ? v : v == null ? "" : String(v);

/**
 * Pull RFC 5322 Message-IDs out of an In-Reply-To / References header value.
 * References carries a whitespace-separated chain; both are normalised to the
 * bare `<id>` tokens, most recent first, so the newest ancestor wins when
 * matching against stored comment message ids.
 */
function parseMessageIds(raw: string): string[] {
  const ids = raw.match(/<[^<>\s]+>/g);
  if (!ids) {
    const bare = raw.trim();
    return bare ? [bare] : [];
  }
  return ids.reverse();
}

/**
 * Normalise a webhook payload into an InboundEmail. Accepts a generic JSON shape
 * plus the common field names used by SendGrid Inbound Parse and Mailgun Routes,
 * so most providers work without a bespoke adapter:
 *   from  ← from | sender | envelope.from
 *   text  ← text | body-plain | stripped-text | body
 *   subject ← subject
 *   messageId  ← message-id | Message-Id | messageId | headers["message-id"]
 *   inReplyTo  ← in-reply-to | In-Reply-To | headers[...]
 *   references ← references | References | headers[...]
 *
 * The three threading fields are optional: providers that drop them fall back to
 * subject matching, which is why `ensureTicketRef` stamps the id on every reply.
 */
export function normalizeInbound(body: unknown): InboundEmail {
  const b = (body ?? {}) as Record<string, unknown>;
  const envelope =
    typeof b.envelope === "string"
      ? safeJson(b.envelope)
      : (b.envelope as Record<string, unknown> | undefined);
  const headers =
    typeof b.headers === "string"
      ? safeJson(b.headers)
      : (b.headers as Record<string, unknown> | undefined);

  /** Read a header from the top level or a nested `headers` object, any casing. */
  const header = (...names: string[]): string => {
    for (const n of names) {
      const direct = asString(b[n] ?? b[n.toLowerCase()]);
      if (direct) return direct;
      if (headers) {
        const nested = asString(headers[n] ?? headers[n.toLowerCase()]);
        if (nested) return nested;
      }
    }
    return "";
  };

  const rawFrom =
    asString(b.from) ||
    asString(b.sender) ||
    asString(envelope?.from) ||
    "";
  const { email, name } = parseEmailAddress(rawFrom);
  if (!email || !email.includes("@")) {
    throw BadRequest("Inbound email is missing a valid From address");
  }

  const subject = asString(b.subject).trim() || "(no subject)";
  const text =
    asString(b.text) ||
    asString(b["body-plain"]) ||
    asString(b["stripped-text"]) ||
    asString(b.body) ||
    "";

  const messageId = parseMessageIds(
    header("message-id", "messageId", "Message-ID"),
  )[0];
  // In-Reply-To names the direct parent; References carries the whole chain.
  // Try the direct parent first, then walk the chain newest-first.
  const inReplyTo = [
    ...parseMessageIds(header("in-reply-to", "inReplyTo", "In-Reply-To")),
    ...parseMessageIds(header("references", "References")),
  ];

  return {
    from: email,
    fromName: name,
    subject,
    text,
    messageId,
    inReplyTo: inReplyTo.length > 0 ? [...new Set(inReplyTo)] : undefined,
  };
}

function safeJson(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
