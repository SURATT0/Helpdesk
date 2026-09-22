import type { UploadedFile } from "../attachments/attachment.service";
import {
  persistIntakeAttachments,
  validateIntakeAttachments,
  type AttachmentValidationResult,
} from "./intake-attachments";
import { persistIntake, recordSpamSubmission } from "./intake.repository";
import { validateIntakeFields } from "./intake.validators";

export type IntakeOutcome =
  | { kind: "created"; ticketId: number; ticketNumber: string; attachments: number }
  | { kind: "spam"; fakeTicketNumber: string }
  | { kind: "consent_required" }
  | { kind: "invalid"; fields: Record<string, string> }
  | ({ kind: "file_rejected" } & AttachmentValidationResult & { ok: false });

/**
 * Whether the honeypot caught something. A NON-EMPTY `website` field is the
 * tell (§03 step 2) — the real form's hidden input is never filled by a
 * person, and the deployed client never even sends the key when it is empty
 * (see the phase-1 compatibility review), so any truthy value here came from
 * something that filled every field it could find, or that is POSTing
 * directly without having seen the client's own JS skip the field.
 */
function honeypotTripped(raw: Record<string, unknown>): boolean {
  const value = raw.website;
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The full write path, honeypot included — the one entry point the route
 * (step 6) calls with a parsed body and any uploaded files.
 *
 * A honeypot hit skips straight to `recordSpamSubmission` and returns a fake
 * number: not a rejection (still 201, per §03 step 2 — tipping off a bot that
 * it was caught costs nothing and gains nothing) and not run through the
 * strict field validator (a bot's payload need not be well-formed for this
 * path to do its job).
 *
 * Everything else — validate-then-persist for a genuine submission — is
 * unchanged: files are validated and rejected (413/415, per the API
 * contract) BEFORE `persistIntake` runs, a deliberate departure from the
 * design doc's own step order (§03 lists "write DB" at step 6 and "handle
 * attachments" at step 7), because its own acceptance criterion is stronger
 * than its own step numbering: "every error case answers per the API
 * contract without leaving stray data" (§14). A file rejected AFTER the
 * ticket exists would need the ticket rolled back too, which is extra
 * machinery in service of matching a step count rather than the actual rule.
 */
export async function submitIntake(
  raw: Record<string, unknown>,
  files: UploadedFile[],
  meta: { ip: string | null; userAgent: string | null },
): Promise<IntakeOutcome> {
  if (honeypotTripped(raw)) {
    const fakeTicketNumber = await recordSpamSubmission(raw, meta);
    return { kind: "spam", fakeTicketNumber };
  }

  const fileCheck = validateIntakeAttachments(files);
  if (!fileCheck.ok) {
    return { kind: "file_rejected", ...fileCheck };
  }

  const result = validateIntakeFields(raw);
  if (!result.ok) {
    return result.reason === "consent"
      ? { kind: "consent_required" }
      : { kind: "invalid", fields: result.fields };
  }

  const persisted = await persistIntake(result.data, meta);
  const attachments = await persistIntakeAttachments(
    persisted.ticketId,
    persisted.submissionId,
    persisted.requesterId,
    files,
  );
  return {
    kind: "created",
    ticketId: persisted.ticketId,
    ticketNumber: persisted.ticketNumber,
    attachments: attachments.length,
  };
}
