import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../../config/env";
import { logger } from "../../shared/logger";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";
import { mailSender } from "../integrations/email/mail-sender";
import { escapeHtml } from "../emails/email.templates";
import {
  emailOutboxRepository,
  type ClaimedEmail,
} from "../emails/email-outbox.repository";
import { INTAKE_EMAIL_EVENTS, type EmailEvent } from "../emails/email.events";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * The two public-intake mails (design doc §07), queued through the SAME
 * `email_outbox` table the ticket-lifecycle mail uses — for its atomic claim
 * and exponential-backoff retry, which is exactly the "SMTP down must not
 * lose the ticket" requirement and not worth a second implementation — but
 * rendered and delivered here, never through `emailOutboxService`/
 * `renderEmail`. Those assume a reader who can sign in and see a fact table
 * about status/priority/assignee and a `/tickets/:id` link; a public
 * submitter can do neither, and the fields this needs (company, phone, the
 * message itself, which customer the domain matched) have no place in that
 * shape at all. See `email.events.ts`'s comment on `INTAKE_EMAIL_EVENTS` for
 * the fuller version of this rationale.
 */
export type IntakeMailPayload = {
  ticketId: number;
  ticketNumber: string;
  name: string;
  businessEmail: string;
  companyName: string;
  phone: string;
  service: string;
  message: string;
  /** The customer the email domain matched, or null — the "triage" case. */
  matchedCustomerName: string | null;
};

/**
 * Where a reply lands: the support inbox, so a reply threads back in through
 * email-to-ticket rather than bouncing off whatever `from` address the mail
 * left on. Same fallback both mails share — see the config comment.
 */
export function replyTo(): string {
  return env.publicIntake.supportInbox ?? env.smtp.from ?? "";
}

/**
 * Queue both mails inside the CALLER's transaction (intake.repository.ts) —
 * "write the DB, then mail" (design doc §03 step 8) means the ticket and the
 * intent to mail commit together; the actual SMTP send happens later, off a
 * timer, against rows a rolled-back transaction would never have left behind.
 *
 * `requesterId` is the ticket's own real requester (found or created by
 * `emailRepository.findOrCreateRequester` — see intake.repository.ts),
 * reused here only to satisfy `email_outbox.recipient_user_id`, which is
 * NOT NULL. It plays no role in where either mail is actually delivered;
 * `recipientEmail` on each row is what `send()` uses.
 */
export async function queueIntakeEmails(
  tx: Tx,
  requesterId: number,
  payload: IntakeMailPayload,
): Promise<void> {
  await tx.emailOutbox.createMany({
    data: [
      {
        ticketId: payload.ticketId,
        eventType: "intake.confirmation" satisfies EmailEvent,
        sourceRecordId: payload.ticketId,
        recipientUserId: requesterId,
        recipientEmail: payload.businessEmail,
        lang: "th",
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      {
        ticketId: payload.ticketId,
        eventType: "intake.team_notify" satisfies EmailEvent,
        sourceRecordId: payload.ticketId,
        recipientUserId: requesterId,
        recipientEmail: replyTo(),
        lang: "th",
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });
}

type Rendered = { subject: string; text: string; html: string };

/**
 * To the person who submitted the form. Thai only, matching the form itself
 * — there is no language signal from an anonymous sender to pick another
 * from — and deliberately NOT built from the shared `renderEmail`: that
 * function's fact table and `/tickets/:id` link both assume a reader who can
 * sign in, which nobody reading this mail can.
 *
 * Wording echoes the form's own success screen (`public/intake/index.html`)
 * rather than inventing new copy for the same moment.
 */
export function renderConfirmation(p: IntakeMailPayload): Rendered {
  const subject = `[${p.ticketNumber}] รับเรื่องแล้ว — ${p.service}`;
  const text = [
    `สวัสดีคุณ ${p.name}`,
    "",
    `เราได้รับเรื่องของคุณแล้ว เลขที่ตั๋วของคุณคือ ${p.ticketNumber}`,
    "",
    `เรื่องที่แจ้ง: ${p.service}`,
    `รายละเอียด: ${p.message}`,
    "",
    "ทีมงานจะติดต่อกลับภายใน 1 วันทำการ",
    "ตอบกลับอีเมลฉบับนี้เพื่อเพิ่มรายละเอียดหรือแนบไฟล์ได้ทันที",
    "",
    "—",
    "Bluefish Support",
  ].join("\n");
  const e = escapeHtml;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111827;max-width:640px">` +
    `<h1 style="margin:0 0 16px;font-size:18px;font-weight:600">รับเรื่องเรียบร้อย</h1>` +
    `<p style="margin:0 0 12px">สวัสดีคุณ ${e(p.name)}</p>` +
    `<p style="margin:0 0 12px">เราได้รับเรื่องของคุณแล้ว เลขที่ตั๋วของคุณคือ</p>` +
    `<p style="font-size:20px;font-weight:600;margin:0 0 16px">${e(p.ticketNumber)}</p>` +
    `<table style="margin:16px 0;border-collapse:collapse;font-size:13px">` +
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top">เรื่องที่แจ้ง</td><td style="padding:4px 0;color:#111827">${e(p.service)}</td></tr>` +
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top">รายละเอียด</td><td style="padding:4px 0;color:#111827;white-space:pre-wrap">${e(p.message)}</td></tr>` +
    `</table>` +
    `<p style="margin:0 0 8px">ทีมงานจะติดต่อกลับภายใน 1 วันทำการ</p>` +
    `<p style="margin:0 0 20px">ตอบกลับอีเมลฉบับนี้เพื่อเพิ่มรายละเอียดหรือแนบไฟล์ได้ทันที</p>` +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">` +
    `<p style="margin:0;color:#6b7280;font-size:12px">Bluefish Support</p>` +
    `</div>`;
  return { subject, text, html };
}

/** To the team — every submitted field, whether it matched a customer, a link into Deskly. */
export function renderTeamNotify(p: IntakeMailPayload): Rendered {
  const subject = `[${p.ticketNumber}] ใหม่ — ${p.companyName}`;
  const matchLine = p.matchedCustomerName
    ? `จับคู่ลูกค้า: ${p.matchedCustomerName}`
    : "จับคู่ลูกค้า: ไม่พบ — รอ triage ผูกลูกค้า";
  const ticketUrl = `${env.webOrigin.replace(/\/+$/, "")}/tickets/${p.ticketId}`;
  const rows: Array<[string, string]> = [
    ["เลขที่ตั๋ว", p.ticketNumber],
    ["ชื่อผู้แจ้ง", p.name],
    ["อีเมล", p.businessEmail],
    ["บริษัท", p.companyName],
    ["เบอร์ติดต่อ", p.phone],
    ["บริการ", p.service],
    ["การจับคู่ลูกค้า", p.matchedCustomerName ?? "ไม่พบ — รอ triage ผูกลูกค้า"],
  ];
  const text = [
    `ตั๋วใหม่จากฟอร์มสาธารณะ: ${p.ticketNumber}`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `รายละเอียด: ${p.message}`,
    "",
    matchLine,
    "",
    `ดูตั๋วใน Deskly: ${ticketUrl}`,
  ].join("\n");
  const e = escapeHtml;
  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${e(label)}</td>` +
        `<td style="padding:4px 0;color:#111827">${e(value)}</td></tr>`,
    )
    .join("");
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111827;max-width:640px">` +
    `<h1 style="margin:0 0 16px;font-size:18px;font-weight:600">ตั๋วใหม่จากฟอร์มสาธารณะ</h1>` +
    `<table style="margin:16px 0;border-collapse:collapse;font-size:13px">${rowsHtml}</table>` +
    `<div style="margin:12px 0;padding:12px 14px;background:#f9fafb;border-left:3px solid #d1d5db">` +
    `<div style="color:#6b7280;font-size:12px;margin-bottom:6px">รายละเอียด</div>` +
    `<div style="color:#111827;white-space:pre-wrap">${e(p.message)}</div></div>` +
    `<p style="margin:0 0 20px">${e(matchLine)}</p>` +
    `<p style="margin:20px 0"><a href="${e(ticketUrl)}" style="display:inline-block;padding:9px 16px;background:#1f2937;color:#ffffff;text-decoration:none;border-radius:6px">ดูตั๋วใน Deskly</a></p>` +
    `</div>`;
  return { subject, text, html };
}

export function render(row: ClaimedEmail): Rendered {
  const payload = row.payload as unknown as IntakeMailPayload;
  return row.eventType === "intake.confirmation"
    ? renderConfirmation(payload)
    : renderTeamNotify(payload);
}

/**
 * Deliver what is due, for the two intake events only — see `claimDue`'s
 * `eventTypeIn` and the comment on why this partitions the table rather than
 * sharing `emailOutboxService.sweep()`.
 *
 * No rate limiting, no digest-collapsing, no thread-anchor lookup: each event
 * fires exactly once per ticket (enforced by the same unique key the
 * ticket-lifecycle mail uses), so there is nothing to collapse and no prior
 * mail in the thread to chain onto.
 */
export async function sweepIntakeMail(now: Date = new Date()): Promise<{
  sent: number;
  failed: number;
}> {
  const cfg = env.ticketEmail;
  const claimed = await emailOutboxRepository.claimDue(
    cfg.batchLimit,
    Math.max(cfg.backoffBaseMs, 60_000),
    now,
    INTAKE_EMAIL_EVENTS,
  );
  const totals = { sent: 0, failed: 0 };

  for (const row of claimed) {
    try {
      if (!env.ticketEmail.enabled) {
        await emailOutboxRepository.markSuppressed(row.id, "event_disabled");
        continue;
      }
      const rendered = render(row);
      const rt = replyTo() || undefined;
      const result = await mailSender.send({
        from: rt ?? row.recipientEmail,
        to: row.recipientEmail,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        replyTo: rt,
        headers: { "X-Deskly-Ticket-Id": String(row.ticketId) },
      });
      await emailOutboxRepository.markSent(row.id, result.messageId, now);
      await auditRepository.record({
        userId: null,
        action: "email.sent",
        entity: "ticket",
        entityId: row.ticketId,
        meta: {
          eventType: row.eventType,
          recipient: row.recipientEmail,
          transport: result.transport,
          outboxId: row.id,
        },
      });
      totals.sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (row.attempts >= cfg.maxAttempts) {
        await emailOutboxRepository.markFailed(row.id, message);
        logger.warn(
          { outboxId: row.id, ticketId: row.ticketId, attempts: row.attempts },
          "giving up on a public-intake email after the last attempt",
        );
        totals.failed += 1;
        continue;
      }
      // Same 1m → 5m → 25m backoff the ticket-lifecycle sweep uses.
      const delay = cfg.backoffBaseMs * Math.pow(5, row.attempts - 1);
      await emailOutboxRepository.reschedule(
        row.id,
        new Date(now.getTime() + delay),
        message,
      );
      logger.info(
        { outboxId: row.id, attempt: row.attempts, retryInMs: delay },
        "public-intake email failed; rescheduled",
      );
    }
  }

  return totals;
}
