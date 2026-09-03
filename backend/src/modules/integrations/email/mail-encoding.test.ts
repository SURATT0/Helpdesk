import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import { renderEmail } from "../../emails/email.templates";
import type { RequesterPayload } from "../../emails/email.events";

/**
 * What actually goes on the wire.
 *
 * The template tests assert what we composed; this asserts what SMTP will
 * carry — a Thai subject line is not ASCII, and an unencoded one arrives as
 * mojibake or gets the message rejected. nodemailer does the RFC 2047 encoding,
 * so this is a test of the seam rather than of our own code: it fails if the
 * library is swapped, upgraded into different behaviour, or handed a field in a
 * way that skips the encoder.
 *
 * Built through a stream transport, which produces the real MIME document
 * without a server anywhere.
 */

const payload: RequesterPayload = {
  audience: "requester",
  ticket: {
    id: 1046,
    subject: "เครื่องพิมพ์ชั้น 3 กระดาษติดซ้ำ",
    displayStatus: "pending",
    priority: "high",
    category: "ฮาร์ดแวร์",
    requesterName: "สมชาย ใจดี",
    assigneeName: "Jo Patel",
  },
  occurredAt: "2026-09-03T07:32:00.000Z",
  message: { authorName: "Jo Patel", body: "เปลี่ยนชุดทำความร้อนแล้วครับ" },
  vars: { recipientName: "สมชาย" },
};

async function buildRaw(lang: "en" | "th"): Promise<string> {
  const rendered = renderEmail("ticket.pending", payload, lang, {
    webOrigin: "https://desk.example.com",
  });
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });
  const info = await transport.sendMail({
    from: "Deskly Support <support@deskly.local>",
    to: "somchai@example.com",
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    inReplyTo: "<first@deskly>",
    references: ["<first@deskly>"],
    headers: { "X-Deskly-Ticket-Id": "1046" },
  });
  return (info.message as Buffer).toString("utf8");
}

describe("a Thai subject survives the wire", () => {
  it("is encoded per RFC 2047 rather than sent as raw bytes", async () => {
    const raw = await buildRaw("th");
    const subjectLine = raw
      .split(/\r?\n/)
      .find((l) => l.startsWith("Subject:"));
    expect(subjectLine).toBeDefined();
    // Either the base64 or the quoted-printable form of the encoded-word.
    expect(subjectLine).toMatch(/=\?UTF-8\?[BQ]\?/i);
    // And never the bare non-ASCII text, which is what breaks in transit.
    expect(subjectLine).not.toContain("เครื่องพิมพ์");
  });

  it("keeps the ticket tag readable inside the encoded subject", async () => {
    const raw = await buildRaw("th");
    // Decode every encoded-word back and confirm the tag the inbound parser
    // needs is still there — an encoding that mangles it would break threading
    // without breaking delivery, which is the failure nobody notices.
    const decoded = raw
      .split(/\r?\n/)
      .filter((l) => l.startsWith("Subject:") || /^\s+=\?/.test(l))
      .join("")
      .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_m, b64: string) =>
        Buffer.from(b64, "base64").toString("utf8"),
      );
    expect(decoded).toContain("[Deskly #1046]");
  });

  // The subject line is built from the TICKET's title, not from the reader's
  // language — so a Thai-titled ticket is encoded even in an English mail, and
  // only an ASCII title travels as-is. Worth pinning: it is the difference
  // between "encode when the reader is Thai" (wrong) and "encode when the bytes
  // are not ASCII" (right).
  it("leaves an ASCII subject unencoded", async () => {
    const ascii: RequesterPayload = {
      ...payload,
      ticket: { ...payload.ticket, subject: "Printer jam on floor 3" },
    };
    const rendered = renderEmail("ticket.pending", ascii, "th", {
      webOrigin: "https://desk.example.com",
    });
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });
    const info = await transport.sendMail({
      from: "support@deskly.local",
      to: "somchai@example.com",
      subject: rendered.subject,
      text: rendered.text,
    });
    const raw = (info.message as Buffer).toString("utf8");
    expect(raw).toContain("Subject: [Deskly #1046] Printer jam on floor 3");
  });
});

describe("the message is multipart, not HTML alone", () => {
  it("carries both a text/plain and a text/html part", async () => {
    const raw = await buildRaw("th");
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("text/plain");
    expect(raw).toContain("text/html");
  });

  it("carries the threading and routing headers", async () => {
    const raw = await buildRaw("th");
    expect(raw).toContain("In-Reply-To: <first@deskly>");
    expect(raw).toContain("References: <first@deskly>");
    // nodemailer normalises the field name's casing (it emits `-ID`). Header
    // names are case-insensitive per RFC 5322 and every provider lowercases
    // them on the way back in, so the inbound side must not match on case —
    // asserted case-insensitively here to say so.
    expect(raw).toMatch(/^x-deskly-ticket-id: 1046$/im);
  });
});
