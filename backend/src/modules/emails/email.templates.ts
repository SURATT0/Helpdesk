import { ticketRef } from "../integrations/email/email.parsers";
import { t, type Lang } from "../../shared/i18n";
import type { EmailEvent, EmailPayload } from "./email.events";

/**
 * Rendering one queued event into the two bodies a mail carries.
 *
 * Every mail goes out as multipart alternative — `text/plain` AND `text/html`,
 * never HTML alone. The plain part is not a courtesy: a help desk writes to
 * whatever client the correspondent happens to use, and an HTML-only message is
 * an empty message in a text client and a spam signal to several filters.
 */

/** How much of the ticket's own subject survives into the mail's subject line. */
export const SUBJECT_MAX = 60;

/**
 * Wall-clock zone every timestamp is written in.
 *
 * A single named zone rather than each reader's own: the server does not know
 * where anyone is, and a time with no zone is the one that gets misread. The
 * zone is NAMED in the output for the same reason.
 */
export const EMAIL_TIMEZONE = "Asia/Bangkok";

export type RenderedEmail = { subject: string; text: string; html: string };

/**
 * The subject line, identical for every mail about a ticket.
 *
 * Sameness is the point: `[Deskly #1046] <subject>` is what the inbound parser
 * reads, and a stable subject is also what mail clients group into one
 * conversation. The cost is that the subject alone does not say WHICH update
 * this is — that is the body's first line, and the trade is deliberate.
 */
export function buildSubject(ticketId: number, ticketSubject: string): string {
  return `${ticketRef(ticketId)} ${truncate(ticketSubject, SUBJECT_MAX)}`;
}

/**
 * Cut to `max` CHARACTERS, ellipsis included in the budget.
 *
 * Counted with the spread operator rather than `.length`, which counts UTF-16
 * code units: an emoji is two of those and would make a 60-"character" subject
 * silently shorter, and slicing at an arbitrary unit can cut a surrogate pair in
 * half and emit a replacement character. Thai combining marks are separate code
 * points and stay attached to the character before them here, which is what
 * matters for reading it.
 */
export function truncate(value: string, max: number): string {
  const chars = [...value.trim()];
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * A timestamp written the way the reader's language writes one, in a named zone.
 *
 * Thai renders through `th-TH`, which puts the year in the Buddhist era — the
 * same calendar the web app already shows a Thai reader (see the note in
 * `date-range-picker.tsx`). Two eras between the screen and the inbox would be
 * two answers to the same question.
 */
export function formatWhen(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formatted = new Intl.DateTimeFormat(
    lang === "th" ? "th-TH" : "en-US",
    {
      timeZone: EMAIL_TIMEZONE,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  ).format(date);
  return `${formatted} (${EMAIL_TIMEZONE})`;
}

/** Escape for interpolation into HTML text or an attribute value. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The one sentence that says why this mail exists, per event.
 *
 * `vars` comes from the payload frozen at event time, so an author's name is the
 * name they had when they wrote, not the one they have when the sweep runs.
 */
function leadFor(event: EmailEvent, payload: EmailPayload, lang: Lang): string[] {
  const v = payload.vars ?? {};
  const line = (key: string) => t(lang, key, { id: payload.ticket.id, ...v });

  switch (event) {
    case "ticket.closed":
      // The spec asks a closed ticket to say who closed it — and "nobody" is a
      // real answer here. A `pending → closed` with no actor is the 72h sweep,
      // and saying so is what distinguishes it from a person's decision.
      return [v.actor ? line("body.ticket.closed.byPerson") : line("body.ticket.closed.automatic")];
    case "ticket.pending":
      return [line("body.ticket.pending"), "", line("body.ticket.pending.action")];
    default:
      return [line(`body.${event}`)];
  }
}

type RenderOptions = {
  /** Base URL of the web app, for the ticket link. */
  webOrigin: string;
};

/** The ticket facts table, as label/value pairs in the reader's language. */
function factRows(payload: EmailPayload, lang: Lang): Array<[string, string]> {
  const { ticket } = payload;
  return [
    [t(lang, "label.ticket"), `#${ticket.id}`],
    [t(lang, "label.subject"), ticket.subject],
    [t(lang, "label.status"), t(lang, `status.${ticket.displayStatus}`)],
    [t(lang, "label.priority"), t(lang, `priority.${ticket.priority}`)],
    [t(lang, "label.category"), ticket.category],
    [t(lang, "label.requester"), ticket.requesterName],
    [
      t(lang, "label.assignee"),
      ticket.assigneeName ?? t(lang, "label.unassigned"),
    ],
    [t(lang, "label.when"), formatWhen(payload.occurredAt, lang)],
  ];
}

export function renderEmail(
  event: EmailEvent,
  payload: EmailPayload,
  lang: Lang,
  opts: RenderOptions,
): RenderedEmail {
  const { ticket } = payload;
  const url = `${opts.webOrigin.replace(/\/+$/, "")}/tickets/${ticket.id}`;
  const headline = t(lang, `headline.${event}`, payload.vars ?? {});
  const greeting = t(lang, "body.greeting", {
    name: payload.vars?.recipientName ?? "",
  });
  const lead = leadFor(event, payload, lang).map((l) =>
    l
      .replace(/\{confirmUrl\}/g, `${url}?closure=confirm`)
      .replace(/\{reopenUrl\}/g, `${url}?closure=reject`),
  );
  const rows = factRows(payload, lang);
  const internal = event === "comment.internal_note";

  // --- text/plain ---------------------------------------------------------
  const textLines = [headline, "", greeting, "", ...lead, ""];
  for (const [label, value] of rows) textLines.push(`${label}: ${value}`);
  if (payload.message) {
    textLines.push(
      "",
      `${t(lang, "label.latestMessage")} — ${t(lang, "label.from")} ${payload.message.authorName}:`,
      payload.message.body,
    );
  }
  textLines.push("", `${t(lang, "label.viewTicket")}: ${url}`, "", "—");
  if (internal) textLines.push(t(lang, "footer.internalWarning"));
  textLines.push(t(lang, "footer.why"), t(lang, "footer.replyHint"));
  const text = textLines.join("\n");

  // --- text/html ----------------------------------------------------------
  // Inline styles and a table layout, because mail clients strip <style> blocks
  // and have no flexbox. Everything interpolated is escaped: subjects, names and
  // message bodies are all user-written.
  const e = escapeHtml;
  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${e(label)}</td>` +
        `<td style="padding:4px 0;color:#111827">${e(value)}</td></tr>`,
    )
    .join("");
  const messageHtml = payload.message
    ? `<div style="margin:20px 0;padding:12px 14px;background:#f9fafb;border-left:3px solid #d1d5db">` +
      `<div style="color:#6b7280;font-size:12px;margin-bottom:6px">${e(t(lang, "label.latestMessage"))} — ${e(t(lang, "label.from"))} ${e(payload.message.authorName)}</div>` +
      `<div style="color:#111827;white-space:pre-wrap">${e(payload.message.body)}</div></div>`
    : "";
  const internalHtml = internal
    ? `<p style="margin:0 0 12px;padding:8px 10px;background:#fef3c7;color:#92400e;font-size:12px">${e(t(lang, "footer.internalWarning"))}</p>`
    : "";
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111827;max-width:640px">` +
    internalHtml +
    `<h1 style="margin:0 0 16px;font-size:18px;font-weight:600">${e(headline)}</h1>` +
    `<p style="margin:0 0 12px">${e(greeting)}</p>` +
    lead
      .filter((l) => l !== "")
      .map(
        (l) =>
          `<p style="margin:0 0 12px;white-space:pre-wrap">${linkify(e(l))}</p>`,
      )
      .join("") +
    `<table style="margin:16px 0;border-collapse:collapse;font-size:13px">${rowsHtml}</table>` +
    messageHtml +
    `<p style="margin:20px 0"><a href="${e(url)}" style="display:inline-block;padding:9px 16px;background:#1f2937;color:#ffffff;text-decoration:none;border-radius:6px">${e(t(lang, "label.viewTicket"))}</a></p>` +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">` +
    `<p style="margin:0;color:#6b7280;font-size:12px">${e(t(lang, "footer.why"))}<br>${e(t(lang, "footer.replyHint"))}</p>` +
    `</div>`;

  return { subject: buildSubject(ticket.id, ticket.subject), text, html };
}

/**
 * Turn the already-escaped URLs the pending template embeds into anchors.
 *
 * Runs AFTER escaping and matches only our own `http(s)://…` origins, so it can
 * only ever wrap text this module put there — it is not a general linkifier for
 * user content, which is exactly what it must not become.
 */
function linkify(escaped: string): string {
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (u) => `<a href="${u}" style="color:#1d4ed8">${u}</a>`,
  );
}
