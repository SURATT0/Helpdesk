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
 * The tag as we WRITE it. Branded, because a subject line landing in a stranger's
 * inbox has to say which desk it came from.
 */
export function ticketRef(ticketId: number): string {
  return `[Deskly #${ticketId}]`;
}

/**
 * The tag as we READ it — deliberately wider than what we write.
 *
 * Outbound mail carried a bare `[#123]` before the tag was branded, and those
 * messages are still sitting in correspondents' mailboxes. A reply to one of
 * them has to keep landing on its ticket, so the `Deskly` half is optional here
 * and mandatory in `ticketRef` above. Narrowing this to the branded form alone
 * would turn every reply to an older mail into a duplicate ticket.
 *
 * Matched anywhere in the line, because mail clients prepend their own localised
 * `Re:` / `Fwd:` / `RE[2]:` before it.
 */
const TICKET_REF_PATTERN = /\[(?:Deskly\s*)?#(\d{1,10})\]/;

/**
 * The public-intake reference (`[BF-20260921-0042]` — see
 * `publicIntake/intake-mail.ts`'s `renderConfirmation`/`renderTeamNotify`,
 * the only writers of this tag). A SEPARATE pattern from the one above,
 * never merged into it: that tag's captured digits ARE the ticket id, so
 * reading it needs no database; this one is a public reference that has no
 * relationship to the id at all, so resolving it is necessarily a lookup
 * (`ticketRepository.findIdByNumber`, called from `email.service.ts` — this
 * file stays a pure parser with no database access of its own).
 *
 * The prefix is intentionally NOT pinned to today's `TICKET_PREFIX` (default
 * `BF`): a deployment that changes it must keep matching replies to numbers
 * it issued under the old one, and every issued number is still sitting
 * verbatim in `tickets.number` regardless of what the current env says — the
 * lookup, not this regex, is what actually decides whether it is real.
 */
const PUBLIC_TICKET_REF_PATTERN = /\[([A-Z]{2,10}-\d{8}-\d{4})\]/;

/**
 * Guarantee a subject carries its ticket reference, without duplicating one that
 * is already correct (a long `Re: Re:` chain must not accrete tags).
 *
 * The tag is what `parseTicketRef` reads on the way back in, so any outbound mail
 * that omits it produces a reply which cannot be threaded — it opens a duplicate
 * ticket instead. Stamping it here rather than at each call site means a
 * caller-supplied subject can't quietly break threading.
 */
export function ensureTicketRef(subject: string, ticketId: number): string {
  const trimmed = subject.trim();
  const found = trimmed.match(TICKET_REF_PATTERN);
  if (found && Number(found[1]) === ticketId) return trimmed;
  return `${ticketRef(ticketId)} ${trimmed}`.trim();
}

/**
 * Pull a ticket reference out of a subject line — the read side of
 * `TICKET_REF_PATTERN` and `PUBLIC_TICKET_REF_PATTERN`, and what makes a
 * mailed reply land on its existing ticket instead of opening a duplicate.
 *
 * Tries the numeric tag FIRST. Both patterns are bracketed, but a
 * public-intake subject only ever carries the `BF-...` form (see
 * `PUBLIC_TICKET_REF_PATTERN`'s own comment) so there is nothing to prefer
 * between them in practice — this is only about which one a caller reads
 * when both happen to be present, which a staff reply CAN produce (see
 * `ensureTicketRef`: it does not strip an existing public tag when adding
 * the numeric one).
 *
 * At most one of `ticketId` / `ticketNumber` is ever non-null. `ticketId` is
 * the ticket's real id, ready to use. `ticketNumber` is NOT: it is a public
 * reference with no relationship to the id, so the caller (`email.service.ts`)
 * still has to resolve it — see `PUBLIC_TICKET_REF_PATTERN`'s comment on why
 * that lookup does not belong in this file.
 */
export function parseTicketRef(subject: string): {
  ticketId: number | null;
  ticketNumber: string | null;
  subject: string;
} {
  const m = subject.match(TICKET_REF_PATTERN);
  if (m) {
    const ticketId = Number(m[1]);
    if (Number.isSafeInteger(ticketId) && ticketId > 0) {
      return {
        ticketId,
        ticketNumber: null,
        subject: subject.replace(m[0], "").replace(/\s{2,}/g, " ").trim(),
      };
    }
  }
  const p = subject.match(PUBLIC_TICKET_REF_PATTERN);
  if (p) {
    return {
      ticketId: null,
      ticketNumber: p[1],
      subject: subject.replace(p[0], "").replace(/\s{2,}/g, " ").trim(),
    };
  }
  return { ticketId: null, ticketNumber: null, subject: subject.trim() };
}

const asString = (v: unknown): string =>
  typeof v === "string" ? v : v == null ? "" : String(v);

/**
 * Normalise a webhook payload into an InboundEmail. Accepts a generic JSON shape
 * plus the common field names used by SendGrid Inbound Parse and Mailgun Routes,
 * so most providers work without a bespoke adapter:
 *   from  ← from | sender | envelope.from
 *   text  ← text | body-plain | stripped-text | body
 *   subject ← subject
 *   messageId ← message-id | Message-Id | headers["message-id"]
 *   inReplyTo ← in-reply-to | In-Reply-To | headers["in-reply-to"]
 */
export function normalizeInbound(body: unknown): InboundEmail {
  const b = (body ?? {}) as Record<string, unknown>;
  const envelope =
    typeof b.envelope === "string"
      ? safeJson(b.envelope)
      : (b.envelope as Record<string, unknown> | undefined);

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

  const headers =
    typeof b.headers === "string"
      ? safeJson(b.headers)
      : (b.headers as Record<string, unknown> | undefined);
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = asString(b[k]) || asString(headers?.[k]);
      if (v.trim()) return v.trim();
    }
    return undefined;
  };

  // Header names are case-insensitive per RFC 5322 and every provider picks its
  // own casing on the way through — nodemailer emits `X-Deskly-Ticket-ID`,
  // SendGrid lowercases, Mailgun preserves. Listing the forms rather than
  // matching one is what keeps the round trip working across providers.
  const rawTicketId = pick(
    "x-deskly-ticket-id",
    "X-Deskly-Ticket-Id",
    "X-Deskly-Ticket-ID",
  );
  const parsedTicketId = rawTicketId ? Number(rawTicketId) : NaN;

  return {
    from: email,
    fromName: name,
    subject,
    text,
    messageId: pick("message-id", "Message-Id", "Message-ID", "messageId"),
    inReplyTo: pick("in-reply-to", "In-Reply-To", "inReplyTo"),
    ticketIdHeader:
      Number.isSafeInteger(parsedTicketId) && parsedTicketId > 0
        ? parsedTicketId
        : undefined,
  };
}

function safeJson(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
