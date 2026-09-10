import { env } from "../../config/env";
import { logger } from "../../shared/logger";
import { DEFAULT_LANG, t, type Lang } from "../../shared/i18n";
import { escapeHtml } from "../emails/email.templates";
import { mailSender } from "../integrations/email/mail-sender";

/**
 * Account mail: confirm your address, reset your password, you were approved.
 *
 * Sent DIRECTLY through `mailSender` rather than queued into `email_outbox`, and
 * the reason is structural rather than a preference: `email_outbox.ticket_id` is
 * a required column with a foreign key behind it, because that table exists to
 * carry a ticket's correspondence and to be read back by the Activity log on
 * that ticket. None of these mails has a ticket, and widening that column to
 * nullable to fit them would make "which ticket is this about" unanswerable for
 * the rows that do have one.
 *
 * What that costs, stated plainly: no retry and no backoff. A reset mail that
 * fails to leave the building is simply not sent, where a ticket notification
 * would be tried again three times. The reason it is acceptable HERE is that
 * every one of these has a person waiting on it who can ask again — "resend the
 * link" is the retry, and it is a better one, because an hour-old queued reset
 * link arriving after three backoffs has expired anyway.
 *
 * The send is deliberately not awaited by the caller's response either — see
 * `sendAndForget`.
 */

/** One line of body copy, or a button. Rendered into both alternatives. */
type Block = { kind: "text"; value: string } | { kind: "button"; label: string; href: string };

/**
 * A link into the web app.
 *
 * Built from `env.webOrigin`, which is the FIRST entry of WEB_ORIGIN and never
 * the host the request happened to arrive on. A link is built here and clicked
 * somewhere else, hours later, from a mail client that has no idea what a LAN
 * address was — and a reset link pointing at a dead host is a person locked out.
 *
 * The token goes in the query string rather than the path only because that is
 * what the pages read; either way it is a credential in a URL, which is why it
 * is single-use and short-lived, and why the pages POST it rather than acting on
 * the GET.
 */
function appLink(path: string, token: string): string {
  const url = new URL(path, env.webOrigin);
  url.searchParams.set("token", token);
  return url.toString();
}

function render(blocks: Block[]): { text: string; html: string } {
  const text = blocks
    .map((b) => (b.kind === "text" ? b.value : `${b.label}: ${b.href}`))
    .join("\n\n");

  const html = blocks
    .map((b) =>
      b.kind === "text"
        ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937">${escapeHtml(b.value)}</p>`
        : // The URL is also printed as text under the button, on purpose: a
          // client that strips styling or blocks the link still leaves the
          // person something they can copy.
          `<p style="margin:0 0 8px"><a href="${escapeHtml(b.href)}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#3f8f5e;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">${escapeHtml(b.label)}</a></p>` +
          `<p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:#6b7280;word-break:break-all">${escapeHtml(b.href)}</p>`,
    )
    .join("");

  return {
    text,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px">${html}</div>`,
  };
}

/**
 * Send without making the caller wait, and without letting a mail failure fail
 * the request.
 *
 * Both halves matter for these endpoints in particular. Waiting would put an
 * SMTP handshake on the response path of `/register` and `/forgot-password`, and
 * `/forgot-password` must answer in the same time whether or not it actually
 * sent anything — an endpoint that is measurably slower when the address exists
 * is the enumeration oracle the uniform reply was written to close.
 *
 * A failure is logged and dropped. The person can ask again, which is this
 * table's retry (see the note at the top of the file).
 */
function sendAndForget(mail: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): void {
  void mailSender
    .send({ from: env.smtp.from || `Deskly <no-reply@deskly.local>`, ...mail })
    .catch((error: unknown) => {
      // The address is NOT logged. These logs are read by people who are not
      // entitled to know who is resetting a password, and an address plus
      // "password reset" is exactly the pairing that should not sit in a log
      // aggregator. The user id is enough to chase a real failure.
      logger.error({ err: error, subject: mail.subject }, "account mail failed to send");
    });
}

export const authMail = {
  /** "Confirm your address" — sent on successful self-registration. */
  sendEmailVerification(to: string, name: string, token: string, lang: Lang = DEFAULT_LANG) {
    const hours = Math.round(env.emailVerificationTtlSec / 3600);
    const { text, html } = render([
      { kind: "text", value: t(lang, "account.verify.greeting", { name }) },
      { kind: "text", value: t(lang, "account.verify.body") },
      {
        kind: "button",
        label: t(lang, "account.verify.cta"),
        href: appLink("/verify-email", token),
      },
      { kind: "text", value: t(lang, "account.verify.expiry", { hours }) },
      { kind: "text", value: t(lang, "account.verify.pending") },
      { kind: "text", value: t(lang, "account.verify.ignore") },
    ]);
    sendAndForget({ to, subject: t(lang, "account.verify.subject"), text, html });
  },

  /**
   * "Someone tried to register your address" — sent to the EXISTING owner when
   * an address that already has an account is submitted to `/register`.
   *
   * This mail is the whole reason registration can answer uniformly. The person
   * at the form is told nothing; the person who owns the address is told
   * everything, and they are the one with a reason to know.
   */
  sendAlreadyRegistered(to: string, lang: Lang = DEFAULT_LANG) {
    const { text, html } = render([
      { kind: "text", value: t(lang, "account.exists.body") },
      { kind: "text", value: t(lang, "account.exists.action") },
      { kind: "text", value: t(lang, "account.exists.ignore") },
    ]);
    sendAndForget({ to, subject: t(lang, "account.exists.subject"), text, html });
  },

  /** "Reset your password" — the only mail carrying a password-reset token. */
  sendPasswordReset(to: string, token: string, lang: Lang = DEFAULT_LANG) {
    const minutes = Math.round(env.passwordResetTtlSec / 60);
    const { text, html } = render([
      { kind: "text", value: t(lang, "account.reset.body") },
      {
        kind: "button",
        label: t(lang, "account.reset.cta"),
        href: appLink("/reset-password", token),
      },
      { kind: "text", value: t(lang, "account.reset.expiry", { minutes }) },
      { kind: "text", value: t(lang, "account.reset.signout") },
      { kind: "text", value: t(lang, "account.reset.ignore") },
    ]);
    sendAndForget({ to, subject: t(lang, "account.reset.subject"), text, html });
  },
};
