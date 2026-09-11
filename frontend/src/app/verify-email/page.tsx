"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { verifyEmail } from "@/features/auth/api";
import {
  AuthError,
  AuthLink,
  AuthNotice,
  AuthShell,
} from "@/features/auth/components/auth-shell";
import { useI18n } from "@/features/i18n/context";
import { ApiError } from "@/lib/api-client";
import type { UserStatus } from "@/features/auth/schemas";

/**
 * Redeem an email-confirmation link.
 *
 * This page POSTs the token on mount rather than offering a button, which is the
 * opposite of what /reset-password does, and the difference is deliberate:
 * confirming an address grants nothing — the account stays `pending` and still
 * cannot sign in — so there is no credential here for a link scanner to burn,
 * and making a person click "confirm" after they already clicked "confirm" in
 * their mail is a step that buys nothing.
 *
 * What it must NOT do is say "you're all set". Confirming is one of two gates,
 * and the second one belongs to somebody else — so the copy on success names
 * what is still outstanding, per the status the server hands back.
 */
function VerifyEmail() {
  const { t } = useI18n();
  const token = useSearchParams().get("token");
  const [state, setState] = React.useState<
    { kind: "working" } | { kind: "done"; status: UserStatus } | { kind: "failed"; message: string }
  >({ kind: "working" });

  /**
   * Which token has already been sent, so it is sent exactly once.
   *
   * A ref rather than the usual `cancelled` cleanup flag, because that pattern
   * is actively WRONG here. React runs effects twice in development's strict
   * mode, and the token is single-use: the first request succeeds and burns it,
   * the second is correctly refused. A cleanup flag suppresses the first
   * result and lets the second through — so the page would report a failure for
   * a confirmation that had just worked, in dev only, which is exactly where a
   * person is testing this by hand.
   *
   * Guarding the SEND rather than the result is what fixes it: the second pass
   * never issues a request, so there is no failure to show.
   */
  const attempted = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!token) {
      setState({ kind: "failed", message: t("verify.noToken") });
      return;
    }
    if (attempted.current === token) return;
    attempted.current = token;
    void (async () => {
      try {
        setState({ kind: "done", status: await verifyEmail(token) });
      } catch (err) {
        setState({
          kind: "failed",
          message: err instanceof ApiError ? err.message : t("verify.error"),
        });
      }
    })();
  }, [token, t]);

  if (state.kind === "working") {
    return <AuthShell title={t("verify.working")} />;
  }

  if (state.kind === "failed") {
    return (
      <AuthShell title={t("verify.failedTitle")}>
        <div className="flex flex-col gap-4">
          <AuthError>{state.message}</AuthError>
          <AuthNotice>{t("verify.failedHint")}</AuthNotice>
          <div className="text-center">
            <AuthLink href="/login">{t("register.backToSignIn")}</AuthLink>
          </div>
        </div>
      </AuthShell>
    );
  }

  // Confirmed. Which sentence comes next depends on what is still outstanding —
  // `active` means somebody has already approved them and they can go straight
  // in; anything else means they cannot, and the page has to say so rather than
  // send them to a sign-in form that will refuse them.
  const approved = state.status === "active";
  return (
    <AuthShell title={t("verify.doneTitle")}>
      <div className="flex flex-col gap-4">
        <AuthNotice tone="success">{t("verify.confirmed")}</AuthNotice>
        <AuthNotice>
          {approved ? t("verify.readyToSignIn") : t("verify.stillPending")}
        </AuthNotice>
        <div className="text-center">
          <AuthLink href="/login">
            {approved ? t("register.signIn") : t("register.backToSignIn")}
          </AuthLink>
        </div>
      </div>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <React.Suspense fallback={<AuthShell title="…" />}>
      <VerifyEmail />
    </React.Suspense>
  );
}
