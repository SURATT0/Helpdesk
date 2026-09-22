import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../shared/db";
import { TEXT_MAX } from "../../shared/text";
import { storedCategoryOther } from "../../shared/category-other";
import { computeDueAt } from "../tickets/sla";
import { emailRepository } from "../integrations/email/email.repository";
import { matchCustomerByDomain } from "./customerMatch";
import { queueIntakeEmails } from "./intake-mail";
import { issueTicketNumber } from "./ticket-number";
import type { ValidatedIntake } from "./intake.validators";

/** Every intake ticket lands here until a person triages it — see §04. */
const DEFAULT_INTAKE_PRIORITY = "medium" as const;

/**
 * The consent notice's own text, snapshotted verbatim rather than referenced —
 * `ConsentLog.consentText` needs to survive the notice page being reworded.
 * Copied from the deployed form (`public/intake/index.html`'s `#consent`
 * label) rather than composed here, so the row says what the person actually
 * read. If the form's wording changes, this constant and `CONSENT_VERSION`
 * both need a matching edit — nothing derives one from the other.
 */
const CONSENT_TEXT =
  "ยินยอมให้ Bluefish เก็บและใช้ข้อมูลนี้เพื่อติดต่อกลับและดำเนินการตามคำขอ (ตาม PDPA)";

/**
 * A label for the wording above, not a fact this code can derive — bump it by
 * hand whenever `CONSENT_TEXT` (or the live form's own wording) changes.
 * There is no product surface for choosing this yet, hence the env escape
 * hatch; a fixed literal would be no worse today but would need a code change
 * for what should be a content change.
 */
const CONSENT_VERSION = process.env.PDPA_CONSENT_VERSION ?? "2026-09-21";

export class OtherCategoryMissingError extends Error {
  constructor(customerId: number) {
    super(`Customer #${customerId} has no "Other" category — every tenant should.`);
    this.name = "OtherCategoryMissingError";
  }
}

export type PersistedIntake = {
  ticketId: number;
  ticketNumber: string;
  submissionId: number;
  requesterId: number;
  /** Whether the email domain matched an existing customer. */
  linked: boolean;
};

/**
 * The single transaction behind a non-spam submission: issue the ticket
 * number, create the ticket, the intake submission, and the consent log.
 * Attachment rows are NOT created here — see the note in
 * `intake.service.ts` on why that waits for the file pipeline (step 4).
 *
 * Retries the WHOLE transaction (not just the number issuance, which is
 * already atomic on its own — see `issueTicketNumber`) up to 3 times on a
 * unique violation on `tickets.number`, per design doc §06. Each attempt is a
 * fresh transaction because Postgres aborts an entire transaction on a
 * constraint violation; there is no statement-level retry inside one.
 */
export async function persistIntake(
  data: ValidatedIntake,
  meta: { ip: string | null; userAgent: string | null },
): Promise<PersistedIntake> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await runOnce(data, meta);
    } catch (err) {
      lastError = err;
      if (!isTicketNumberCollision(err) || attempt === MAX_ATTEMPTS) throw err;
    }
  }
  // Unreachable — the loop always returns or throws — but keeps TypeScript
  // (and a future refactor) honest about what happens if it didn't.
  throw lastError;
}

function isTicketNumberCollision(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    (err.meta?.target as string[] | undefined)?.includes("number") === true
  );
}

async function runOnce(
  data: ValidatedIntake,
  meta: { ip: string | null; userAgent: string | null },
): Promise<PersistedIntake> {
  return prisma.$transaction(async (tx) => {
    const matched = await matchCustomerByDomain(tx, data.businessEmail);
    const targetCustomerId = matched
      ? matched.id
      : await systemTenantId(tx);

    // The same "reuse an existing account, else create a passwordless
    // correspondent" logic email intake already uses for an unknown sender
    // (email.repository.ts) — reused rather than reinvented, and for the
    // same reason: a matched submitter who already has a Deskly login gets
    // THEIR OWN ticket attached to their own account, so they see it under
    // ticketScopeWhere's ordinary `{requesterId: user.id}` rule with no
    // special case needed. A genuinely new submitter gets a real row under
    // the resolved tenant instead of one shared account absorbing everyone.
    // `findOrCreateRequester` was widened (an optional `db`/`via`) rather
    // than duplicated for this — see its own comment in email.repository.ts.
    const requester = await emailRepository.findOrCreateRequester(
      data.businessEmail,
      data.name,
      targetCustomerId,
      tx,
      "web-intake",
    );

    const otherCategory = await tx.category.findFirst({
      where: { customerId: targetCustomerId, code: "OTHER" },
      select: { id: true },
    });
    if (!otherCategory) throw new OtherCategoryMissingError(targetCustomerId);

    const ticketNumber = await issueTicketNumber(tx);
    const now = new Date();
    const subject = `${data.service} — ${data.companyName}`.slice(
      0,
      TEXT_MAX.SUBJECT,
    );

    const ticket = await tx.ticket.create({
      data: {
        subject,
        description: data.message,
        status: "new",
        priority: DEFAULT_INTAKE_PRIORITY,
        requesterId: requester.id,
        customerId: targetCustomerId,
        categoryId: otherCategory.id,
        categoryOther: storedCategoryOther({
          categoryCode: "OTHER",
          categoryOther: `Public intake — service requested: ${data.service}`,
        }),
        projectId: null,
        channel: "web_intake",
        number: ticketNumber,
        reportedAt: data.submittedAt,
        dueAt: computeDueAt(DEFAULT_INTAKE_PRIORITY, now),
        createdAt: now,
      },
      select: { id: true },
    });

    await tx.ticketStatusHistory.create({
      data: {
        ticketId: ticket.id,
        fromStatus: null,
        toStatus: "new",
        changedById: requester.id,
      },
    });

    const submission = await tx.intakeSubmission.create({
      data: {
        ticketId: ticket.id,
        name: data.name,
        businessEmail: data.businessEmail,
        companyName: data.companyName,
        phone: data.phone,
        service: data.service,
        message: data.message,
        source: data.source,
        status: matched ? "linked" : "triage",
        matchedCustomerId: matched?.id ?? null,
        isFreeMail: data.isFreeMail,
        ip: meta.ip,
        userAgent: meta.userAgent,
        submittedAt: data.submittedAt,
      },
      select: { id: true },
    });

    await tx.consentLog.create({
      data: {
        submissionId: submission.id,
        consentText: CONSENT_TEXT,
        consentVersion: CONSENT_VERSION,
        granted: true,
        ip: meta.ip,
        userAgent: meta.userAgent,
        grantedAt: data.submittedAt,
      },
    });

    // Queued here, inside this same transaction — "write the DB, then mail"
    // (design doc §03 step 8) means the intent to mail commits WITH the
    // ticket. The actual SMTP send happens later, off `sweepIntakeMail`'s own
    // timer, against a row a rolled-back attempt would never have left behind.
    await queueIntakeEmails(tx, requester.id, {
      ticketId: ticket.id,
      ticketNumber,
      name: data.name,
      businessEmail: data.businessEmail,
      companyName: data.companyName,
      phone: data.phone,
      service: data.service,
      message: data.message,
      matchedCustomerName: matched?.name ?? null,
    });

    return {
      ticketId: ticket.id,
      ticketNumber,
      submissionId: submission.id,
      requesterId: requester.id,
      linked: matched != null,
    };
  });
}

/**
 * What the honeypot caught: no ticket, nobody mailed, but the submission is
 * still written down — deliberately (design doc §03 step 2 and the schema's
 * own comment on `IntakeStatus.spam`), because the only way to tell a tuned
 * honeypot from a broken one is to look at what it caught.
 *
 * Deliberately lenient rather than running the real field validator: a bot's
 * payload is not expected to be well-formed, and the point of this path is to
 * still answer 201 with a plausible-looking number so it does not learn it
 * was caught — rejecting malformed spam with a 400 would do exactly that.
 * Every field is coerced to a bounded, NUL-free string with a fallback, since
 * every intake_submissions text column is NOT NULL.
 */
export async function recordSpamSubmission(
  raw: Record<string, unknown>,
  meta: { ip: string | null; userAgent: string | null },
): Promise<string> {
  const safe = (value: unknown, max: number, fallback: string): string => {
    const asString =
      typeof value === "string" ? value : value == null ? "" : String(value);
    // eslint-disable-next-line no-control-regex -- stripping the one byte Postgres text columns refuse (SQLSTATE 22021)
    const cleaned = asString.replace(/\u0000/g, "").trim().slice(0, max);
    return cleaned.length > 0 ? cleaned : fallback;
  };

  await prisma.intakeSubmission.create({
    data: {
      ticketId: null,
      name: safe(raw.name, 200, "(unknown)"),
      businessEmail: safe(raw.businessEmail, 254, "unknown@spam.invalid"),
      companyName: safe(raw.companyName, 200, "(unknown)"),
      phone: safe(raw.phone, 30, "-"),
      service: safe(raw.service, 100, "-"),
      message: safe(raw.message, 2000, "-"),
      source: safe(raw.source, 100, "unknown"),
      status: "spam",
      isFreeMail: false,
      ip: meta.ip,
      userAgent: meta.userAgent,
      // The server's own clock, not the caller's claimed `submittedAt` — a
      // bot's payload is not trusted for anything, timing included.
      submittedAt: new Date(),
    },
  });

  return fakeTicketNumber();
}

/**
 * A number shaped exactly like a real one but never issued from
 * `ticket_number_counters` — spam must not consume a real sequence value
 * (real numbers would visibly skip), and answering with anything obviously
 * fake would tell the sender their submission was caught.
 */
function fakeTicketNumber(): string {
  const now = new Date();
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const seq = Math.floor(1000 + Math.random() * 9000);
  return `${env.publicIntake.ticketPrefix}-${day}-${seq}`;
}

/**
 * The placeholder tenant's id. Looked up fresh every call rather than
 * memoised: it reads as a fixed, never-renamed row, but `Customer.deletedById`
 * is a foreign key TO `users`, which makes `customers` a child of `users` for
 * Postgres's purposes — a wipe-and-reseed cycle (the integration suite's
 * `resetDb`, or a restored backup) can and does hand it a different id than
 * last time. A cache here would go stale silently and file tickets under
 * whatever id it first saw, which is a worse failure than one extra indexed
 * lookup on a table with a handful of rows.
 */
async function systemTenantId(tx: Prisma.TransactionClient | PrismaClient): Promise<number> {
  const row = await tx.customer.findFirst({
    where: { isSystemTenant: true },
    select: { id: true },
  });
  if (!row) {
    throw new Error(
      "No customer is flagged is_system_tenant — the public-intake bootstrap " +
        "migration (20260921100000_public_intake_schema) has not run.",
    );
  }
  return row.id;
}
