import { z } from "zod";
import { freeText } from "../../shared/text";

/**
 * Field caps for the intake form. Independent of `shared/text.ts`'s
 * `TEXT_MAX` — these bound what a STRANGER may type into a form nobody signs
 * into, not what a signed-in agent types into a ticket, so they stay smaller
 * and are named here rather than growing that shared table for one caller.
 */
const INTAKE_MAX = {
  NAME: 200,
  COMPANY: 200,
  PHONE: 30,
  SERVICE: 100,
  MESSAGE: 2000,
  SOURCE: 100,
} as const;

/**
 * Free mailbox domains the client itself flags (`FREE_MAIL` in the intake
 * form's script). Kept identical rather than re-derived, so a submission that
 * would have shown "use your company email" in the browser sets the same
 * `isFreeMail` flag when it reaches here some other way — a direct API call,
 * or a browser with JavaScript errors swallowing the client check.
 *
 * NEVER used to reject. The client used to hard-block on this list, which
 * contradicts the design doc directly (§09: flag for triage, never refuse) and
 * turns away a real small business that has no domain of its own — a plain
 * validation error is not the fix for that; it means the client needs the same
 * correction the server got here.
 */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "hotmail.com",
  "hotmail.co.th",
  "yahoo.com",
  "yahoo.co.th",
  "outlook.com",
  "live.com",
  "icloud.com",
  "msn.com",
  "protonmail.com",
]);

/**
 * Digits only, 9–15 of them — the same test the client runs (§09), applied to
 * whatever was actually sent rather than trusted from a client that agrees.
 */
function phoneDigitsOk(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

/**
 * The shape every intake submission is validated against, regardless of
 * whether it arrived as JSON or as multipart fields — see `normalizeConsent`
 * and `normalizeAttachments` below for the two places those wire formats
 * actually differ.
 *
 * `website` (the honeypot) is deliberately NOT required and carries no format
 * check: the real form never sends the key at all when it is empty (see the
 * phase-1 compatibility note), so a schema that required it would reject every
 * ordinary submission from that client. Its value, if any, is read by the
 * caller BEFORE this validator runs — see intake.service.ts — because a
 * honeypot hit skips full field validation rather than failing it.
 */
const intakeFieldsSchema = z.object({
  name: freeText({ min: 2, max: INTAKE_MAX.NAME }),
  businessEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("invalid email format")
    .max(254),
  companyName: freeText({ min: 2, max: INTAKE_MAX.COMPANY }),
  phone: freeText({ max: INTAKE_MAX.PHONE }).refine(phoneDigitsOk, {
    message: "phone must have 9-15 digits",
  }),
  // Raw service code, kept as sent. Not a z.enum: the catalog is a product
  // decision (see the phase-1 review — 13 codes across 4 groups today) that
  // must not need a backend deploy to grow, and an unrecognised code still
  // opens a ticket for a human to categorise, per §04.
  service: freeText({ max: INTAKE_MAX.SERVICE }),
  message: freeText({ min: 15, max: INTAKE_MAX.MESSAGE }),
  source: freeText({ max: INTAKE_MAX.SOURCE }),
  submittedAt: z.coerce.date(),
  website: z.string().optional(),
});

export type ValidatedIntake = {
  name: string;
  businessEmail: string;
  companyName: string;
  phone: string;
  service: string;
  message: string;
  source: string;
  submittedAt: Date;
  /** The client's own honeypot hint, forwarded rather than acted on here. */
  website?: string;
  /** businessEmail's domain is one of FREE_MAIL_DOMAINS — never a rejection. */
  isFreeMail: boolean;
};

export type IntakeValidationResult =
  | { ok: true; data: ValidatedIntake }
  /**
   * Consent was missing or false. Kept apart from `fields` below because the
   * two failures are answered differently at the wire (422 vs 400) and because
   * this ONE reason must stop the request before a single row is written —
   * even the spam-status row a honeypot hit still gets. See intake.service.ts.
   */
  | { ok: false; reason: "consent" }
  | { ok: false; reason: "fields"; fields: Record<string, string> };

/**
 * `FormData.append('consent', true)` stringifies to `"true"` — a fact about
 * `FormData`, not about the sender's intent, so the multipart path must accept
 * it as equivalent to the JSON path's real boolean. Anything else (missing,
 * `false`, `"false"`, absent) is "not granted": the design doc's consent gate
 * is a strict yes, never a best guess at one.
 */
function normalizeConsent(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * The pure validation step — no I/O, no persistence, callable identically for
 * the JSON and multipart request bodies once each has normalized `consent`
 * (see `normalizeConsent`) into what this expects. `attachments`, if present
 * in the raw body, is intentionally ignored here rather than rejected: the
 * JSON-only path from the real form sends `attachments: []` even with no
 * files (see the phase-1 compatibility review) — actual files never arrive
 * through this object, only through multer's `req.files`.
 */
export function validateIntakeFields(
  raw: Record<string, unknown>,
): IntakeValidationResult {
  if (!normalizeConsent(raw.consent)) {
    return { ok: false, reason: "consent" };
  }

  const parsed = intakeFieldsSchema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in fields)) {
        fields[key] = issue.message;
      }
    }
    return { ok: false, reason: "fields", fields };
  }

  const domain = parsed.data.businessEmail.split("@")[1] ?? "";
  return {
    ok: true,
    data: {
      ...parsed.data,
      isFreeMail: FREE_MAIL_DOMAINS.has(domain),
    },
  };
}
