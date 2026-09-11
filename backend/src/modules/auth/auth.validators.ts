import { z } from "zod";

export const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * What a password has to be.
 *
 * Length only, and no composition rules — no "one capital, one digit, one
 * symbol". That is deliberate and follows current guidance (NIST SP 800-63B):
 * composition rules push people towards `Password1!` and towards reusing the one
 * they already have, which loses more than the rules gain. Length is the part
 * that actually buys entropy, so that is the part this asks for.
 *
 * The 72-byte ceiling is bcrypt's, not a policy: bcrypt silently TRUNCATES
 * beyond it, so a 200-character passphrase would be stored as its first 72 bytes
 * and two different long passwords could both open the account. Refusing is
 * honest where truncating is not. Counted in bytes rather than characters
 * because that is what bcrypt counts, and a Thai or emoji password reaches 72
 * bytes in far fewer characters than an ASCII one.
 */
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_BYTES = 72;

export const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES,
    `Password must be at most ${MAX_PASSWORD_BYTES} bytes`,
  );

/**
 * Confirmation is checked HERE, on the server, not only in the form.
 *
 * A mismatch the browser catches is a nicety; this is the one that counts,
 * because the endpoint is reachable without the browser. Same reason every other
 * field on this object is validated rather than trusted.
 */
const withConfirmation = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({ ...shape, password, confirmPassword: z.string() })
    .refine((v) => v.password === v.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    });

export const registerBody = withConfirmation({
  email: z.string().email().max(254),
  // 254 is the maximum length of an email address (RFC 5321). The name limit is
  // ours, and generous — it exists so the column cannot be used as free storage.
  name: z.string().trim().min(1, "Name is required").max(120),
  /**
   * Which language to write the confirmation mail in.
   *
   * Declared here and not merely accepted, because `z.object` STRIPS keys it
   * does not know: without this line the field the sign-up form sends is
   * silently discarded and every confirmation goes out in the desk's default
   * (Thai) — including to somebody who has just filled the form in English.
   *
   * Optional, because the endpoint is reachable without the form and the server
   * has a perfectly good fallback. An enum rather than a free string so an
   * unknown value is rejected instead of selecting no template at all.
   */
  lang: z.enum(["en", "th"]).optional(),
});

export const forgotPasswordBody = z.object({
  email: z.string().email().max(254),
});

export const resetPasswordBody = withConfirmation({
  token: z.string().min(1),
});

export const verifyEmailBody = z.object({
  token: z.string().min(1),
});
