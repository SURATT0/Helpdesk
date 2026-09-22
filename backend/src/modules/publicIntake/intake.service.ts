import type { UploadedFile } from "../attachments/attachment.service";
import {
  persistIntakeAttachments,
  validateIntakeAttachments,
  type AttachmentValidationResult,
} from "./intake-attachments";
import { persistIntake } from "./intake.repository";
import { validateIntakeFields } from "./intake.validators";

export type IntakeOutcome =
  | { kind: "created"; ticketId: number; ticketNumber: string; attachments: number }
  | { kind: "consent_required" }
  | { kind: "invalid"; fields: Record<string, string> }
  | ({ kind: "file_rejected" } & AttachmentValidationResult & { ok: false });

/**
 * Validate-then-persist for a genuine (non-spam) submission. Deliberately
 * does NOT check the honeypot (`website`) itself — that is a request-handling
 * decision (skip this entirely, record a spam row instead, still answer 201)
 * that belongs with the route in step 6, not with the write path itself. This
 * function is the write path: given a body (and any uploaded files) that have
 * already passed the honeypot gate, validate everything against the
 * client-mirrored rules and, if it all passes, commit the ticket.
 *
 * Files are validated and rejected (413/415, per the API contract) BEFORE
 * `persistIntake` runs — a deliberate departure from the design doc's own
 * step order (§03 lists "write DB" at step 6 and "handle attachments" at
 * step 7), because its own acceptance criterion is stronger than its own step
 * numbering: "every error case answers per the API contract without leaving
 * stray data" (§14). A file rejected AFTER the ticket exists would need the
 * ticket rolled back too, which is extra machinery in service of matching a
 * step count rather than the actual rule.
 */
export async function submitIntake(
  raw: Record<string, unknown>,
  files: UploadedFile[],
  meta: { ip: string | null; userAgent: string | null },
): Promise<IntakeOutcome> {
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
    files,
  );
  return {
    kind: "created",
    ticketId: persisted.ticketId,
    ticketNumber: persisted.ticketNumber,
    attachments: attachments.length,
  };
}
