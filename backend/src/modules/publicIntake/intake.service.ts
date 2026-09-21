import { persistIntake } from "./intake.repository";
import { validateIntakeFields } from "./intake.validators";

export type IntakeOutcome =
  | { kind: "created"; ticketId: number; ticketNumber: string }
  | { kind: "consent_required" }
  | { kind: "invalid"; fields: Record<string, string> };

/**
 * Validate-then-persist for a genuine (non-spam) submission. Deliberately
 * does NOT check the honeypot (`website`) itself — that is a request-handling
 * decision (skip this entirely, record a spam row instead, still answer 201)
 * that belongs with the route in step 6, not with the write path itself. This
 * function is the write path: given a body that has already passed the
 * honeypot gate, validate it against every client-mirrored rule and, if it
 * passes, commit the one transaction that creates the ticket.
 */
export async function submitIntake(
  raw: Record<string, unknown>,
  meta: { ip: string | null; userAgent: string | null },
): Promise<IntakeOutcome> {
  const result = validateIntakeFields(raw);
  if (!result.ok) {
    return result.reason === "consent"
      ? { kind: "consent_required" }
      : { kind: "invalid", fields: result.fields };
  }

  const persisted = await persistIntake(result.data, meta);
  return {
    kind: "created",
    ticketId: persisted.ticketId,
    ticketNumber: persisted.ticketNumber,
  };
}
