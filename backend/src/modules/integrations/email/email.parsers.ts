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

const asString = (v: unknown): string =>
  typeof v === "string" ? v : v == null ? "" : String(v);

/**
 * Normalise a webhook payload into an InboundEmail. Accepts a generic JSON shape
 * plus the common field names used by SendGrid Inbound Parse and Mailgun Routes,
 * so most providers work without a bespoke adapter:
 *   from  ← from | sender | envelope.from
 *   text  ← text | body-plain | stripped-text | body
 *   subject ← subject
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

  return { from: email, fromName: name, subject, text };
}

function safeJson(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
